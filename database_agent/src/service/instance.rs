use super::{OrInstanceFailure as _, OrStoreFailure as _};
use crate::state::Agent;
use crate::utils::detached;
use database_agent_common::service::DataStream;
use database_agent_common::service::FileResponse;
use database_agent_common::service::instance::InstanceService;
use database_agent_common::service::instance::instance_service_error::{
    CreateInstanceError, DeleteInstanceError, ExportInstanceError, GetInstanceError,
    ImportInstanceError, InstanceLogsError, InstanceUtilizationError, ListInstancesError,
    PowerInstanceError, QueryInstanceError, UpdateInstanceError,
};
use database_agent_common::types::{
    ApiInstance, PowerAction, QueryResult, ResourceUsage, StoredInstanceCreate,
    StoredInstanceUpdate,
};
use futures_util::StreamExt as _;
use uuid::Uuid;
use zelus::async_trait;

#[async_trait]
impl InstanceService for Agent {
    async fn list_instances(&self) -> Result<Vec<ApiInstance>, ListInstancesError> {
        let instances = self.instances.read().await.clone();

        let mut responses = Vec::with_capacity(instances.len());
        for instance in instances {
            responses.push(
                instance
                    .to_api_response()
                    .await
                    .or_store_failure::<ListInstancesError>("failed to read an instance")?,
            );
        }

        Ok(responses)
    }

    async fn create_instance(
        &self,
        create: StoredInstanceCreate,
    ) -> Result<ApiInstance, CreateInstanceError> {
        let agent = self.clone();
        let instance = detached(async move { agent.spawn_instance(create).await })
            .await
            .or_instance_failure::<CreateInstanceError>("failed to create an instance")?;

        instance
            .to_api_response()
            .await
            .or_store_failure("failed to read the new instance")
    }

    async fn get_instance(&self, instance_id: Uuid) -> Result<ApiInstance, GetInstanceError> {
        self.instance(instance_id)
            .await
            .ok_or(GetInstanceError::InstanceNotFound)?
            .to_api_response()
            .await
            .or_store_failure("failed to read an instance")
    }

    async fn update_instance(
        &self,
        instance_id: Uuid,
        update: StoredInstanceUpdate,
    ) -> Result<ApiInstance, UpdateInstanceError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(UpdateInstanceError::InstanceNotFound)?;

        let target = instance.clone();
        detached(async move { target.update(update).await })
            .await
            .or_instance_failure::<UpdateInstanceError>("failed to update an instance")?;

        instance
            .to_api_response()
            .await
            .or_store_failure("failed to read an instance")
    }

    async fn delete_instance(&self, instance_id: Uuid) -> Result<(), DeleteInstanceError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(DeleteInstanceError::InstanceNotFound)?;

        let agent = self.clone();
        detached(async move { agent.remove_instance(&instance).await })
            .await
            .or_instance_failure("failed to delete an instance")
    }

    async fn power_instance(
        &self,
        instance_id: Uuid,
        action: PowerAction,
    ) -> Result<(), PowerInstanceError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(PowerInstanceError::InstanceNotFound)?;

        if matches!(action, PowerAction::Start | PowerAction::Restart)
            && instance.is_disk_full().await
        {
            return Err(PowerInstanceError::InstanceDiskFull);
        }

        detached(async move {
            match action {
                PowerAction::Kill => instance.kill().await,
                PowerAction::Restart => {
                    let _ = instance.stop().await;
                    instance.start().await
                }
                PowerAction::Start => instance.start().await,
                PowerAction::Stop => instance.stop().await,
            }
        })
        .await
        .or_instance_failure("failed to change the instance power state")
    }

    async fn instance_utilization(
        &self,
        instance_id: Uuid,
    ) -> Result<ResourceUsage, InstanceUtilizationError> {
        Ok(self
            .instance(instance_id)
            .await
            .ok_or(InstanceUtilizationError::InstanceNotFound)?
            .resource_usage()
            .await)
    }

    async fn instance_logs(
        &self,
        instance_id: Uuid,
        lines: Option<usize>,
    ) -> Result<FileResponse, InstanceLogsError> {
        let logs = self
            .instance(instance_id)
            .await
            .ok_or(InstanceLogsError::InstanceNotFound)?
            .logs(lines)
            .await;

        Ok(FileResponse::Header {
            stream: DataStream::by_stream(
                None,
                logs.map(|chunk| chunk.map_err(std::io::Error::other)),
            ),
            disposition: None,
            r#type: None,
        })
    }

    async fn export_instance(
        &self,
        instance_id: Uuid,
        database: Option<String>,
    ) -> Result<FileResponse, ExportInstanceError> {
        let reader = self
            .instance(instance_id)
            .await
            .ok_or(ExportInstanceError::InstanceNotFound)?
            .export(database.as_deref())
            .await
            .or_instance_failure::<ExportInstanceError>("failed to export an instance")?;

        Ok(FileResponse::Header {
            stream: DataStream::by_read(reader, None),
            disposition: None,
            r#type: None,
        })
    }

    async fn import_instance(
        &self,
        instance_id: Uuid,
        database: Option<String>,
        wipe: Option<bool>,
        data: DataStream,
    ) -> Result<(), ImportInstanceError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(ImportInstanceError::InstanceNotFound)?;

        let mut reader = data.reader();
        instance
            .import(database.as_deref(), wipe.unwrap_or_default(), &mut reader)
            .await
            .or_instance_failure("failed to import into an instance")
    }

    async fn query_instance(
        &self,
        instance_id: Uuid,
        database: Option<String>,
        query: String,
    ) -> Result<QueryResult, QueryInstanceError> {
        self.instance(instance_id)
            .await
            .ok_or(QueryInstanceError::InstanceNotFound)?
            .query(database.as_deref(), &query)
            .await
            .or_instance_failure("failed to run a query")
    }
}
