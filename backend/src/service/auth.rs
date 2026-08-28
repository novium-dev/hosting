use super::*;
use crate::Backend;
use crate::auth::oauth::flow::OAuthFlow;
use crate::auth::permissions::Role;
use crate::auth::user::{
    SerializedUser, Session, UserAuthentication, WithCookies, clear_session_cookie,
    set_session_cookie,
};
use crate::service::auth::auth_service_error::{CallbackError, LoginDevError, LoginError};
use chrono::Duration;
use oauth2::{AuthorizationCode, PkceCodeVerifier, Scope};
use sqlx::query;
use url::Url;
use zelus::responses::Redirect;
use zelus::{define_path_variable, define_query_variable, service};

define_path_variable!(provider "The OAuth provider");
define_query_variable!(redirect_url "The URL to redirect to after login");
define_query_variable!(code "The authorization code returned by the OAuth provider");
define_query_variable!(state "The state parameter to prevent CSRF attacks");

#[service(path = "/auth", tag = "auth", no_sdk)]
pub(crate) impl AuthService for Backend {
    /// Invalidates the current user session and clears the session cookie.
    #[route("/logout", method = GET, raw)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], auth::unreachable)]
    async fn logout(&self, #[special] auth: UserAuthentication) -> Result<WithCookies<()>, _> {
        auth.session.invalidate(self).await?;
        Ok(WithCookies::new((), vec![clear_session_cookie(self)]))
    }

    /// Retrieves information about the currently authenticated user.
    #[route("/me", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn me(&self, #[special] auth: UserAuthentication) -> Result<SerializedUser, _> {
        Ok(auth.serialized())
    }

    /// Logs in as a seeded admin dev user, attaches the session cookie and
    /// redirects, mirroring the OAuth callback.
    ///
    /// Only available when the crate is built with the `auth_dev` feature, which is forbidden in release builds.
    #[route("/login/dev", method = GET, query = [ redirect_url ], routes = [ dev_auth ], raw)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], os::failure, auth::failure)]
    async fn login_dev(&self, redirect_url: String) -> Result<WithCookies<Redirect<307>>, _> {
        let destination = Url::parse(&redirect_url).map_err(|_err| LoginDevError::AuthFailure)?;

        let session = Session::generate().map_err(|_err| LoginDevError::OsFailure)?;
        let dev_user = 1i32;

        query!(
            "INSERT INTO users
                    (id, username, auth_id, role, email)
                VALUES
                    ($1, 'dev', 'dev', $2, 'dev@example.com')
                ON CONFLICT (id) DO UPDATE SET auth_id = EXCLUDED.auth_id",
            dev_user,
            Role::Admin as i32
        )
        .execute(&*self.database)
        .await?;

        session.apply(self, dev_user).await?;

        Ok(WithCookies::new(
            Redirect::new(destination.as_str()),
            vec![set_session_cookie(self, &session)],
        ))
    }

    /// Initiates the OAuth login process.
    #[route("/login/{provider}", method = GET, query = [ redirect_url ], raw)]
    #[error(auth::failure, cache::failure <- [redis:*])]
    async fn login(&self, provider: String, redirect_url: String) -> Result<Redirect<307>, _> {
        let (url, csrf_token, pkce_verifier) = self.auth.generate_url::<LoginError>(
            &provider,
            ["openid", "profile", "email", "roles"]
                .into_iter()
                .map(String::from)
                .map(Scope::new),
        )?;

        OAuthFlow {
            provider,
            redirect_url: redirect_url.clone(),
            state: csrf_token.into_secret(),
            verifier: pkce_verifier.into_secret(),
        }
        .insert::<LoginError>(Duration::minutes(30), &mut self.cache.clone())
        .await?;

        Ok(Redirect::new(url.as_str()))
    }

    /// Handles the OAuth callback after user authentication.
    #[route("/callback", method = GET, query = [ code, state ], raw)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], os::failure, auth::{failure, permission_denied})]
    async fn callback(&self, code: String, state: String) -> Result<WithCookies<Redirect<307>>, _> {
        let flow = OAuthFlow::get::<CallbackError>(&state, &mut self.cache.clone())
            .await?
            .ok_or(CallbackError::AuthFailure)?;

        let access_token = self
            .auth
            .request_token::<CallbackError>(
                &flow.provider,
                AuthorizationCode::new(code),
                PkceCodeVerifier::new(flow.verifier),
            )
            .await?;

        let mut user = self
            .auth
            .get_user::<CallbackError>(&flow.provider, &access_token)
            .await?;
        let role = self
            .auth
            .role_for::<CallbackError>(&flow.provider, user.roles.as_deref())?;
        user.sub = format!("{}:{}", flow.provider, user.sub);
        let user_id = self.get_or_create_user(user, role).await?;

        let session = Session::generate().map_err(|_err| CallbackError::OsFailure)?;
        session.apply(self, user_id).await?;

        let _ = OAuthFlow::remove(&state, &mut self.cache.clone()).await;

        let redirect_destination =
            Url::parse(&flow.redirect_url).map_err(|_err| CallbackError::AuthFailure)?;

        Ok(WithCookies::new(
            Redirect::new(redirect_destination.as_str()),
            vec![set_session_cookie(self, &session)],
        ))
    }
}
