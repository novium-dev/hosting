use super::*;
use crate::Backend;
use crate::auth::oauth::flow::OAuthFlow;
use crate::auth::permissions::Role;
use crate::auth::user::{SerializedUser, Session, UserAuthentication};
use crate::service::auth::auth_service_error::{CallbackError, LoginDevError, LoginError};
use chrono::Duration;
use oauth2::{AuthorizationCode, PkceCodeVerifier, Scope};
use sqlx::query;
use tracing::error;
use url::Url;
use zelus::responses::Redirect;
use zelus::{define_query_variable, service};

define_query_variable!(redirect_url "The URL to redirect to after login");
define_query_variable!(code "The authorization code returned by the OAuth provider");
define_query_variable!(state "The state parameter to prevent CSRF attacks");

#[service(path = "/auth", tag = "auth", no_sdk)]
pub(crate) impl AuthService for Backend {
    /// Invalidates the current user session.
    #[route("/logout", method = GET)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], auth::unreachable)]
    async fn logout(&self, #[special] auth: UserAuthentication) -> Result<(), _> {
        auth.session.invalidate(self).await?;
        Ok(())
    }

    /// Retrieves information about the currently authenticated user.
    #[route("/me", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn me(&self, #[special] auth: UserAuthentication) -> Result<SerializedUser, _> {
        Ok(auth.serialized())
    }

    #[route("/login/dev", method = GET, routes = [ dev_auth ])]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], os::failure)]
    async fn login_dev(&self) -> Result<String, _> {
        let session = Session::generate().map_err(|_err| LoginDevError::OsFailure)?;
        let dev_user = 1u32;

        query!(
            "INSERT INTO `users`
                    (`id`, `username`, `auth_id`, `role`, `email`)
                VALUES
                    (?, 'dev', 'dev', ?, 'dev@example.com')
                ON DUPLICATE KEY UPDATE `auth_id` = 'dev'",
            dev_user,
            Role::Admin as u8
        )
        .execute(&*self.database)
        .await?;

        session.apply(self, dev_user).await?;

        Ok(session.to_string())
    }

    /// Initiates the OAuth login process.
    #[route("/login", method = GET, query = [ redirect_url ], raw)]
    #[error(auth::misconfigured, cache::failure <- [redis:*])]
    async fn login(&self, redirect_url: String) -> Result<Redirect<307>, _> {
        let (url, csrf_token, pkce_verifier) = self.auth.generate_url(
            ["openid", "profile", "email"]
                .into_iter()
                .map(String::from)
                .map(Scope::new),
        );

        OAuthFlow {
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
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], os::failure, auth::{misconfigured, permission_denied})]
    async fn callback(&self, code: String, state: String) -> Result<Redirect<307>, _> {
        let flow = OAuthFlow::get::<CallbackError>(&state, &mut self.cache.clone())
            .await?
            .ok_or(CallbackError::AuthMisconfigured)?;

        let access_token = self
            .auth
            .request_token(
                AuthorizationCode::new(code),
                PkceCodeVerifier::new(flow.verifier),
            )
            .await
            .map_err(|err| {
                error!("Failed to generate access token: {err:?}");
                CallbackError::AuthMisconfigured
            })?;

        let user = self.auth.get_user::<CallbackError>(&access_token).await?;
        let user_id = self.get_or_create_user(user).await?;

        let session = Session::generate().map_err(|_err| CallbackError::OsFailure)?;
        session.apply(self, user_id).await?;

        let _ = OAuthFlow::remove(&state, &mut self.cache.clone()).await;

        let mut redirect_destination =
            Url::parse(&flow.redirect_url).map_err(|_err| CallbackError::AuthMisconfigured)?;

        redirect_destination
            .query_pairs_mut()
            .append_pair("session", &session.to_string());

        Ok(Redirect::new(redirect_destination.as_str()))
    }
}
