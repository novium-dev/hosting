use super::*;
use crate::Backend;
use crate::auth::oauth::lib::OAuthClient as _;
use crate::auth::oauth_flow::OAuthFlow;
use crate::auth::permissions::Role;
use crate::auth::user::{Session, UserAuthentication};
use crate::service::auth::auth_service_error::{CallbackError, LoginDevError, LoginError};
use chrono::Duration;
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
    /// This does not work for api keys.
    #[route("/logout", method = GET)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*])]
    async fn logout(&self, #[special] auth: UserAuthentication) -> Result<(), _> {
        auth.session.invalidate(self).await?;
        Ok(())
    }

    #[route("/login/dev", method = GET)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], os::failure)]
    async fn login_dev(&self) -> Result<String, _> {
        let session = Session::generate().map_err(|_err| LoginDevError::OsFailure)?;

        query!(
            "INSERT INTO `users`
                    (`id`, `username`, `auth_id`, `permissions`, `role`, `email`)
                VALUES
                    (1, 'dev', 'dev', 0, ?, 'dev@example.com')
                ON DUPLICATE KEY UPDATE `auth_id` = 'dev'",
            Role::Admin as u8
        )
        .execute(&*self.database)
        .await?;

        session.apply(self, 1).await?;

        Ok(session.to_string())
    }

    /// Initiates the OAuth login process.
    #[route("/login", method = GET, query = [ redirect_url ], raw)]
    #[error(auth::misconfigured, cache::failure <- [redis:*])]
    async fn login(&self, redirect_url: String) -> Result<Redirect<307>, _> {
        let client = self.auth.get_client::<LoginError>()?;

        let state_oauth = client
            .generate_url(
                Vec::from([
                    "openid".to_owned(),
                    "profile".to_owned(),
                    "email".to_owned(),
                ]),
                |state_e| async move {
                    let _ = OAuthFlow {
                        redirect_url: redirect_url.clone(),
                        state: state_e.state,
                        verifier: state_e.verifier,
                    }
                    .insert::<LoginError>(Duration::minutes(30), &mut self.cache.clone())
                    .await;
                },
            )
            .await
            .expect("Failed to generate OAuth URL")
            .state
            .ok_or(LoginError::AuthMisconfigured)?;

        Ok(Redirect::new(
            Url::parse(
                state_oauth
                    .url_generated
                    .expect("URL should be generated")
                    .as_str(),
            )
            .map_err(|_err| LoginError::AuthMisconfigured)?
            .as_str(),
        ))
    }

    /// Handles the OAuth callback after user authentication.
    #[route("/callback", method = GET, query = [ code, state ], raw)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*], os::failure, auth::misconfigured, auth::permission_denied)]
    async fn callback(&self, code: String, state: String) -> Result<Redirect<307>, _> {
        let flow = OAuthFlow::get::<CallbackError>(&state, &mut self.cache.clone())
            .await?
            .ok_or(CallbackError::AuthMisconfigured)?;

        let client = self.auth.get_client::<CallbackError>()?;

        let access_token = client
            .generate_token(code, flow.verifier)
            .await
            .map_err(|err| {
                error!("Failed to generate access token: {:?}", err);
                CallbackError::AuthMisconfigured
            })?;

        let user = self.auth.get_user::<CallbackError>(&access_token).await?;

        let user_id = self.get_or_create_user(user).await?;

        let session = Session::generate().map_err(|_err| CallbackError::OsFailure)?;
        session.apply(self, user_id).await?;

        let _ = OAuthFlow::remove(&state, &mut self.cache.clone()).await;

        let redirect_destination =
            Url::parse(&flow.redirect_url).map_err(|_err| CallbackError::AuthMisconfigured)?;

        let final_redirect = redirect_destination
            .join(&format!("?session={session}"))
            .map_err(|_err| CallbackError::AuthMisconfigured)?;

        Ok(Redirect::new(final_redirect.as_str()))
    }
}
