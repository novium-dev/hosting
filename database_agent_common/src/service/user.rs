use super::*;
use crate::types::{StoredUser, UserGrant};
use uuid::Uuid;
use zelus::service;

#[service(path = "/instance/{instance_id}/user", tag = "user")]
pub trait UserService {
    /// Lists the users of an instance with their database grants.
    #[route("", method = GET)]
    #[error(instance::not_found, store::failure)]
    async fn list_users(&self, instance_id: Uuid) -> Result<Vec<StoredUser>, _>;

    /// Creates a user with a generated password and the given database grants.
    #[route("", method = PUT)]
    #[error(instance::{not_found, offline}, database::not_found, user::{name_invalid, failure}, store::failure)]
    async fn create_user(
        &self,
        instance_id: Uuid,
        username: String,
        grants: Vec<UserGrant>,
    ) -> Result<StoredUser, _>;

    /// Returns a single user.
    #[route("/{user_id}", method = GET)]
    #[error(instance::not_found, user::not_found, store::failure)]
    async fn get_user(&self, instance_id: Uuid, user_id: Uuid) -> Result<StoredUser, _>;

    /// Replaces a user's database grants with the given set.
    #[route("/{user_id}/grants", method = PUT)]
    #[error(instance::{not_found, offline}, database::not_found, user::{not_found, failure}, store::failure)]
    async fn set_user_grants(
        &self,
        instance_id: Uuid,
        user_id: Uuid,
        grants: Vec<UserGrant>,
    ) -> Result<StoredUser, _>;

    /// Deletes a user.
    #[route("/{user_id}", method = DELETE)]
    #[error(instance::{not_found, offline}, user::{not_found, failure}, store::failure)]
    async fn delete_user(&self, instance_id: Uuid, user_id: Uuid) -> Result<(), _>;

    /// Replaces a user's password with a freshly generated one and returns it.
    #[route("/{user_id}/rotate", method = POST)]
    #[error(instance::{not_found, offline}, user::{not_found, failure}, store::failure)]
    async fn rotate_user_password(&self, instance_id: Uuid, user_id: Uuid) -> Result<String, _>;
}
