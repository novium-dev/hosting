use super::*;
use crate::Backend;
use crate::auth::permissions::Role;
use crate::auth::user::{Session, UserAuthentication};
use crate::service::auth::auth_service_error::LoginDevError;
use sqlx::query;
use zelus::service;

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
}
