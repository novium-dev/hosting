use super::*;
use crate::types::StoredUser;
use uuid::Uuid;
use zelus::service;

#[service(path = "/instance/{instance_id}/user", tag = "user")]
pub trait UserService {
    /// Lists the users of an instance.
    #[route("", method = GET)]
    #[error(instance::not_found, store::failure)]
    async fn list_users(&self, instance_id: Uuid) -> Result<Vec<StoredUser>, _>;

    /// Creates a user with a generated password, optionally granted on a database.
    #[route("", method = PUT)]
    #[error(instance::{not_found, offline}, database::not_found, user::{name_invalid, failure}, store::failure)]
    async fn create_user(
        &self,
        instance_id: Uuid,
        username: String,
        database_id: Option<Uuid>,
    ) -> Result<StoredUser, _>;

    /// Returns a single user.
    #[route("/{user_id}", method = GET)]
    #[error(instance::not_found, user::not_found, store::failure)]
    async fn get_user(&self, instance_id: Uuid, user_id: Uuid) -> Result<StoredUser, _>;

    /// Deletes a user.
    #[route("/{user_id}", method = DELETE)]
    #[error(instance::{not_found, offline}, user::{not_found, failure}, store::failure)]
    async fn delete_user(&self, instance_id: Uuid, user_id: Uuid) -> Result<(), _>;

    /// Replaces a user's password with a freshly generated one and returns it.
    #[route("/{user_id}/rotate", method = POST)]
    #[error(instance::{not_found, offline}, user::{not_found, failure}, store::failure)]
    async fn rotate_user_password(&self, instance_id: Uuid, user_id: Uuid) -> Result<String, _>;
}
