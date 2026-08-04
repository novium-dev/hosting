use super::*;
use crate::types::{
    ApiInstance, PowerAction, QueryResult, ResourceUsage, StoredInstanceCreate,
    StoredInstanceUpdate,
};
use uuid::Uuid;
use zelus::service;

#[service(path = "/instance", tag = "instance")]
pub trait InstanceService {
    /// Lists every instance managed by this agent.
    #[route("", method = GET)]
    #[error(store::failure, docker::failure)]
    async fn list_instances(&self) -> Result<Vec<ApiInstance>, _>;

    /// Creates a new instance and its container.
    #[route("", method = PUT)]
    #[error(instance::failure, store::failure, docker::failure)]
    async fn create_instance(&self, create: StoredInstanceCreate) -> Result<ApiInstance, _>;

    /// Returns a single instance.
    #[route("/{instance_id}", method = GET)]
    #[error(instance::not_found, store::failure, docker::failure)]
    async fn get_instance(&self, instance_id: Uuid) -> Result<ApiInstance, _>;

    /// Updates an instance's configuration and applies the new limits to the container.
    #[route("/{instance_id}", method = PATCH)]
    #[error(instance::{not_found, failure}, store::failure, docker::failure)]
    async fn update_instance(
        &self,
        instance_id: Uuid,
        update: StoredInstanceUpdate,
    ) -> Result<ApiInstance, _>;

    /// Deletes an instance, its container and all of its data.
    #[route("/{instance_id}", method = DELETE)]
    #[error(instance::{not_found, failure}, store::failure, docker::failure)]
    async fn delete_instance(&self, instance_id: Uuid) -> Result<(), _>;

    /// Starts, stops, restarts or kills an instance.
    #[route("/{instance_id}/power", method = POST)]
    #[error(instance::{not_found, disk_full, failure}, docker::failure)]
    async fn power_instance(&self, instance_id: Uuid, action: PowerAction) -> Result<(), _>;

    /// Returns the current resource usage of an instance.
    #[route("/{instance_id}/utilization", method = GET)]
    #[error(instance::not_found)]
    async fn instance_utilization(&self, instance_id: Uuid) -> Result<ResourceUsage, _>;

    /// Streams the container logs of an instance.
    #[route("/{instance_id}/logs", method = GET, query = [ lines ], raw)]
    #[error(instance::not_found)]
    async fn instance_logs(
        &self,
        instance_id: Uuid,
        lines: Option<usize>,
    ) -> Result<FileResponse, _>;

    /// Dumps an instance, or one of its databases, as a stream.
    #[route("/{instance_id}/export", method = GET, query = [ database ], raw)]
    #[error(instance::{not_found, offline, failure})]
    async fn export_instance(
        &self,
        instance_id: Uuid,
        database: Option<String>,
    ) -> Result<FileResponse, _>;

    /// Restores a dump into an instance, or into one of its databases.
    #[route("/{instance_id}/import", method = POST, query = [ database, wipe ])]
    #[error(instance::{not_found, offline, unsupported, failure})]
    async fn import_instance(
        &self,
        instance_id: Uuid,
        database: Option<String>,
        wipe: Option<bool>,
        data: DataStream,
    ) -> Result<(), _>;

    /// Runs a raw query against an instance.
    #[route("/{instance_id}/query", method = POST)]
    #[error(instance::{not_found, offline, failure})]
    async fn query_instance(
        &self,
        instance_id: Uuid,
        database: Option<String>,
        query: String,
    ) -> Result<QueryResult, _>;
}
