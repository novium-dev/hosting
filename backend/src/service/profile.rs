use super::*;
use crate::Backend;
use crate::auth::user::{UserAuthentication, generate_daemon_password};
use crate::service::profile::profile_service_error::{AddSshKeyError, DeleteSshKeyError};
use serde::Serialize;
use sqlx::query;
use ssh_key::{HashAlg, PublicKey};
use zelus::{define_path_variable, service};

define_path_variable!(key_id "The SSH key ID");

define_error!(profile {
    ssh_key_invalid("Invalid SSH public key" BAD_REQUEST),
    ssh_key_not_found("SSH key not found" NOT_FOUND),
});

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct SshKeyInfo {
    pub(crate) id: i32,
    pub(crate) name: String,
    pub(crate) public_key: String,
}

#[service(path = "/profile", tag = "profile", no_sdk)]
pub(crate) impl ProfileService for Backend {
    /// Lists SSH public keys on the current user's profile.
    #[route("/ssh-keys", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn list_ssh_keys(
        &self,
        #[special] auth: UserAuthentication,
    ) -> Result<Vec<SshKeyInfo>, _> {
        Ok(query!(
            r#"SELECT id, name, public_key FROM user_ssh_keys WHERE "user" = $1 ORDER BY id"#,
            auth.id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| SshKeyInfo {
            id: row.id,
            name: row.name,
            public_key: row.public_key,
        })
        .collect())
    }

    /// Adds an SSH public key to the current user's profile.
    #[route("/ssh-keys", method = PUT)]
    #[error(profile::ssh_key_invalid, db::failure <- [sql:*], auth::unreachable)]
    async fn add_ssh_key(
        &self,
        #[special] auth: UserAuthentication,
        name: String,
        public_key: String,
    ) -> Result<i32, _> {
        let (public_key, fingerprint) =
            parse_ssh_public_key(&public_key).map_err(|()| AddSshKeyError::ProfileSshKeyInvalid)?;

        let record = query!(
            r#"INSERT INTO user_ssh_keys ("user", name, public_key, fingerprint_sha512)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("user", fingerprint_sha512) DO UPDATE SET
                name = EXCLUDED.name,
                public_key = EXCLUDED.public_key
             RETURNING id"#,
            auth.id,
            name,
            public_key,
            fingerprint
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(record.id)
    }

    /// Deletes an SSH public key from the current user's profile.
    #[route("/ssh-keys/{key_id}", method = DELETE)]
    #[error(profile::ssh_key_not_found, db::failure <- [sql:*], auth::unreachable)]
    async fn delete_ssh_key(
        &self,
        #[special] auth: UserAuthentication,
        key_id: i32,
    ) -> Result<(), _> {
        let result = query!(
            r#"DELETE FROM user_ssh_keys WHERE id = $1 AND "user" = $2"#,
            key_id,
            auth.id
        )
        .execute(&*self.database)
        .await?;

        if result.rows_affected() == 0 {
            return Err(DeleteSshKeyError::ProfileSshKeyNotFound);
        }

        Ok(())
    }

    /// Gets the current user's daemon password.
    #[route("/daemon-password", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn daemon_password(&self, #[special] auth: UserAuthentication) -> Result<String, _> {
        let password = ensure_daemon_password(self, auth.id).await?;
        Ok(password)
    }

    /// Replaces the current user's daemon password.
    #[route("/daemon-password/reroll", method = POST)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn reroll_daemon_password(
        &self,
        #[special] auth: UserAuthentication,
    ) -> Result<String, _> {
        let password = generate_daemon_password();
        query!(
            "UPDATE users SET daemon_password = $1 WHERE id = $2",
            password,
            auth.id
        )
        .execute(&*self.database)
        .await?;

        Ok(password)
    }
}

async fn ensure_daemon_password(backend: &Backend, user_id: i32) -> Result<String, sqlx::Error> {
    let row = query!("SELECT daemon_password FROM users WHERE id = $1", user_id)
        .fetch_one(&*backend.database)
        .await?;

    if let Some(password) = row.daemon_password {
        return Ok(password);
    }

    let password = generate_daemon_password();
    query!(
        "UPDATE users SET daemon_password = $1 WHERE id = $2",
        password,
        user_id
    )
    .execute(&*backend.database)
    .await?;

    Ok(password)
}

pub(crate) fn parse_ssh_public_key(public_key: &str) -> Result<(String, String), ()> {
    let public_key = PublicKey::from_openssh(public_key).map_err(|_err| ())?;
    let fingerprint = public_key.fingerprint(HashAlg::Sha512);
    let public_key = public_key.to_openssh().map_err(|_err| ())?;

    Ok((public_key, hex::encode(fingerprint.as_bytes())))
}
