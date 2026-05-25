use super::*;
use crate::Backend;
use crate::auth::user::{UserAuthentication, generate_daemon_password};
use crate::service::profile::profile_service_error::{AddSshKeyError, DeleteSshKeyError};
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use serde::Serialize;
use sha2::{Digest as _, Sha512};
use sqlx::query;
use zelus::{define_path_variable, service};

define_path_variable!(key_id "The SSH key ID");

define_error!(profile {
    ssh_key_invalid("Invalid SSH public key" BAD_REQUEST),
    ssh_key_not_found("SSH key not found" NOT_FOUND),
});

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct SshKeyInfo {
    pub(crate) id: u32,
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
            "SELECT `id`, `name`, `public_key` FROM `user_ssh_keys` WHERE `user` = ? ORDER BY `id`",
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
    ) -> Result<u32, _> {
        let fingerprint = ssh_key_fingerprint_sha512(&public_key)
            .map_err(|()| AddSshKeyError::ProfileSshKeyInvalid)?;

        let result = query!(
            "INSERT INTO `user_ssh_keys` (`user`, `name`, `public_key`, `fingerprint_sha512`)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                `name` = VALUES(`name`),
                `public_key` = VALUES(`public_key`),
                `id` = LAST_INSERT_ID(`id`)",
            auth.id,
            name,
            public_key,
            fingerprint
        )
        .execute(&*self.database)
        .await?;

        Ok(result.last_insert_id() as u32)
    }

    /// Deletes an SSH public key from the current user's profile.
    #[route("/ssh-keys/{key_id}", method = DELETE)]
    #[error(profile::ssh_key_not_found, db::failure <- [sql:*], auth::unreachable)]
    async fn delete_ssh_key(
        &self,
        #[special] auth: UserAuthentication,
        key_id: u32,
    ) -> Result<(), _> {
        let result = query!(
            "DELETE FROM `user_ssh_keys` WHERE `id` = ? AND `user` = ?",
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
            "UPDATE `users` SET `daemon_password` = ? WHERE `id` = ?",
            password,
            auth.id
        )
        .execute(&*self.database)
        .await?;

        Ok(password)
    }
}

async fn ensure_daemon_password(backend: &Backend, user_id: u32) -> Result<String, sqlx::Error> {
    let row = query!(
        "SELECT `daemon_password` FROM `users` WHERE `id` = ?",
        user_id
    )
    .fetch_one(&*backend.database)
    .await?;

    if let Some(password) = row.daemon_password {
        return Ok(password);
    }

    let password = generate_daemon_password();
    query!(
        "UPDATE `users` SET `daemon_password` = ? WHERE `id` = ?",
        password,
        user_id
    )
    .execute(&*backend.database)
    .await?;

    Ok(password)
}

pub(crate) fn ssh_key_fingerprint_sha512(public_key: &str) -> Result<String, ()> {
    let mut parts = public_key.split_whitespace();
    let Some(key_type) = parts.next() else {
        return Err(());
    };
    let Some(encoded_key) = parts.next() else {
        return Err(());
    };

    if !key_type.starts_with("ssh-")
        && !key_type.starts_with("ecdsa-")
        && !key_type.starts_with("sk-")
    {
        return Err(());
    }

    let mut encoded_key = encoded_key.to_owned();
    while encoded_key.len() % 4 != 0 {
        encoded_key.push('=');
    }

    let key_blob = BASE64_STANDARD.decode(encoded_key).map_err(|_err| ())?;
    Ok(hex::encode(Sha512::digest(key_blob)))
}
