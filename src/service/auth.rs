use chrono::Duration;
use super::*;
use crate::Backend;
use crate::auth::user::{Session, UserAuthentication};
use crate::service::auth::auth_service_error::LoginDevError;
use crate::service::auth::auth_service_error::LoginError;
use sqlx::query;
use url::Url;
use zelus::responses::Redirect;
use zelus::{define_query_variable, service};
use crate::auth::oauth_flow::OAuthFlow;

define_query_variable!(redirect_url "The URL to redirect to after login");

#[service(path = "/auth", tag = "auth", no_sdk)]
pub(crate) impl AuthService for Backend {
    /// Invalidates the current user session.
    /// This does not work for api keys.
    #[route("/logout", method = GET)]
    #[error(db(failure [sql:*]) cache(failure [redis:*]))]
    async fn logout(&self, #[special] auth: UserAuthentication) -> Result<(), _> {
        auth.session.invalidate(self).await?;
        Ok(())
    }

    #[route("/login/dev", method = GET)]
    #[error(db(failure [sql:*]) cache(failure [redis:*]) os(failure))]
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

    #[route("/login", method = GET, query = [ redirect_url ], raw)]
    #[error(cache(failure [redis:*]) os(failure) auth(missconfigured))]
    async fn login(&self,
                   redirect_url: String
    ) -> Result<Redirect<307>, _> {
        let state = OAuthFlow {
            redirect_url: redirect_url.clone(),
        }
            .insert(Duration::minutes(30), &mut self.cache.clone())
            .await.map_err(|_err| LoginError::CacheFailure)?;

        let cfg = self.config.auth.url.clone();
        let client_id = self.config.auth.client_id.clone();
        let redirect_uri = self.config.public_url.clone().join("/auth/callback")
            .map_err(|_err| LoginError::AuthMissconfigured)?
            .to_string();

        Ok(Redirect::new(Url::parse_with_params(
            cfg.as_str(),
            &[
                ("client_id", &client_id),
                ("redirect_uri", &redirect_uri.clone()),
                ("state", &state),
                ("scope", &"openid profile email".to_string()),
            ],
        )
            .map_err(|_| LoginError::AuthMissconfigured)?
            .as_str()))
    }
}
