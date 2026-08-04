use super::*;
use crate::types::StoredDatabase;
use uuid::Uuid;
use zelus::service;

#[service(path = "/instance/{instance_id}/database", tag = "database")]
pub trait DatabaseService {
    /// Lists the databases of an instance.
    #[route("", method = GET)]
    #[error(instance::not_found, store::failure)]
    async fn list_databases(&self, instance_id: Uuid) -> Result<Vec<StoredDatabase>, _>;

    /// Creates a database on an instance.
    #[route("", method = PUT)]
    #[error(instance::{not_found, offline}, database::{name_invalid, name_taken, failure}, store::failure)]
    async fn create_database(&self, instance_id: Uuid, name: String) -> Result<StoredDatabase, _>;

    /// Returns a single database.
    #[route("/{database_id}", method = GET)]
    #[error(instance::not_found, database::not_found, store::failure)]
    async fn get_database(&self, instance_id: Uuid, database_id: Uuid)
    -> Result<StoredDatabase, _>;

    /// Deletes a database and every user granted on it.
    #[route("/{database_id}", method = DELETE)]
    #[error(instance::{not_found, offline}, database::{not_found, failure}, store::failure)]
    async fn delete_database(&self, instance_id: Uuid, database_id: Uuid) -> Result<(), _>;

    /// Drops and recreates a database, keeping its users and their grants.
    #[route("/{database_id}/recreate", method = POST)]
    #[error(instance::{not_found, offline}, database::{not_found, failure}, store::failure)]
    async fn recreate_database(&self, instance_id: Uuid, database_id: Uuid) -> Result<(), _>;

    /// Returns the on-disk size of a database in bytes.
    #[route("/{database_id}/size", method = GET)]
    #[error(instance::{not_found, offline}, database::{not_found, failure}, store::failure)]
    async fn database_size(&self, instance_id: Uuid, database_id: Uuid) -> Result<i64, _>;
}
