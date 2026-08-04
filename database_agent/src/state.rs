use crate::config::AgentConfig;
use crate::instance::Instance;
use crate::instance::manager::DatabaseRouteManager;
use crate::store::{Store, data};
use crate::subsystems::SubsystemRegistry;
use bollard::Docker;
use core::ops::Deref;
use database_agent_common::types::StoredInstanceCreate;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{RwLock, Semaphore};
use uuid::Uuid;

pub struct AgentInner {
    pub config: Arc<AgentConfig>,
    pub store: Store,
    pub docker: Docker,

    pub instances: RwLock<Vec<Instance>>,
    pub routes: Arc<DatabaseRouteManager>,
    pub subsystems: Arc<SubsystemRegistry>,

    pub disk_check_semaphore: Semaphore,
    pub started: Instant,
}

#[derive(Clone)]
pub struct Agent(Arc<AgentInner>);

impl Deref for Agent {
    type Target = AgentInner;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Agent {
    pub fn new(config: Arc<AgentConfig>, store: Store, docker: Docker) -> Self {
        Self(Arc::new(AgentInner {
            disk_check_semaphore: Semaphore::new(config.disk_check_concurrency.max(1)),
            config,
            store,
            docker,
            instances: RwLock::new(Vec::new()),
            routes: Arc::default(),
            subsystems: Arc::default(),
            started: Instant::now(),
        }))
    }

    pub async fn load_instances(&self) -> anyhow::Result<()> {
        let mut instances = Vec::new();

        for stored in data::all_instances(self.store.read()).await? {
            let instance = Instance::new(self.clone(), stored);
            instance.resync_users().await?;
            instance.attach_container().await;

            instances.push(instance);
        }

        tracing::info!("loaded {} instances", instances.len());
        *self.instances.write().await = instances;

        Ok(())
    }

    pub async fn instance(&self, uuid: Uuid) -> Option<Instance> {
        self.instances
            .read()
            .await
            .iter()
            .find(|instance| instance.uuid == uuid)
            .cloned()
    }

    pub async fn spawn_instance(
        &self,
        create: StoredInstanceCreate,
    ) -> anyhow::Result<Instance> {
        let stored = data::insert_instance(self.store.write(), create).await?;

        let instance = Instance::new(self.clone(), stored);
        instance.create_container().await?;
        self.instances.write().await.push(instance.clone());

        Ok(instance)
    }

    pub async fn remove_instance(&self, instance: &Instance) -> anyhow::Result<()> {
        instance.destroy_container().await?;

        for directory in [
            self.config.socket_dir(instance.uuid),
            self.config.data_dir(instance.uuid),
        ] {
            if let Err(err) = tokio::fs::remove_dir_all(&directory).await
                && err.kind() != std::io::ErrorKind::NotFound
            {
                tracing::warn!(instance = %instance.uuid, "failed to remove {}: {err}", directory.display());
            }
        }

        data::delete_instance(self.store.write(), instance.uuid).await?;
        self.instances
            .write()
            .await
            .retain(|candidate| candidate.uuid != instance.uuid);

        Ok(())
    }
}
