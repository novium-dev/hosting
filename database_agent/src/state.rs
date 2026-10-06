use crate::config::AgentConfig;
use crate::instance::Instance;
use crate::instance::manager::DatabaseRouteManager;
use crate::store::{Store, data};
use crate::subsystems::SubsystemRegistry;
use bollard::Docker;
use core::ops::Deref;
use core::time::Duration;
use database_agent_common::types::{ContainerState, StoredInstanceCreate};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{RwLock, Semaphore};
use uuid::Uuid;
use zelus_keys::{DaemonKey, DaemonRootKey};

const RESTORE_DELAY: Duration = Duration::from_secs(5);

pub struct AgentInner {
    pub config: Arc<AgentConfig>,
    pub store: Store,
    pub docker: Docker,

    pub root: Arc<DaemonRootKey>,
    pub key: Arc<DaemonKey>,

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
    pub fn new(
        config: Arc<AgentConfig>,
        store: Store,
        docker: Docker,
        root: Arc<DaemonRootKey>,
        key: Arc<DaemonKey>,
    ) -> Self {
        Self(Arc::new(AgentInner {
            disk_check_semaphore: Semaphore::new(config.disk_check_concurrency.max(1)),
            config,
            store,
            docker,
            root,
            key,
            instances: RwLock::new(Vec::new()),
            routes: Arc::default(),
            subsystems: Arc::default(),
            started: Instant::now(),
        }))
    }

    pub async fn load_instances(&self) -> anyhow::Result<()> {
        let mut instances = Vec::new();
        let states = data::instance_states(self.store.read()).await?;

        let autostart_concurrency = self.config.boot_autostart_concurrency;
        let autostart = Arc::new(Semaphore::new(autostart_concurrency));

        for stored in data::all_instances(self.store.read()).await? {
            let state = states.get(&stored.uuid).copied().unwrap_or_default();
            let instance = Instance::new(self.clone(), stored);
            instance.resync_users().await?;
            instance.attach_container().await;

            if autostart_concurrency > 0
                && matches!(state, ContainerState::Running | ContainerState::Starting)
                && !instance.is_suspended().await
            {
                tokio::spawn(self.clone().restore_instance(
                    instance.clone(),
                    state,
                    Arc::clone(&autostart),
                ));
            }

            instances.push(instance);
        }

        tracing::info!("loaded {} instances", instances.len());
        *self.instances.write().await = instances;

        tokio::spawn(self.clone().adopt_running_instances(states));

        Ok(())
    }

    async fn restore_instance(
        self,
        instance: Instance,
        state: ContainerState,
        autostart: Arc<Semaphore>,
    ) {
        tokio::time::sleep(RESTORE_DELAY).await;
        if instance.container_state().await != ContainerState::Offline {
            return;
        }

        let Ok(permit) = autostart.acquire().await else {
            return;
        };
        if self.instance(instance.uuid).await.is_none() {
            return;
        }

        tracing::info!(instance = %instance.uuid, "restoring instance state {state:?}");
        instance.check_disk_usage().await;

        if let Err(err) = instance.start().await {
            tracing::error!(instance = %instance.uuid, "failed to restore the instance: {err:#}");
        }
        drop(permit);
    }

    async fn adopt_running_instances(self, stored: HashMap<Uuid, ContainerState>) {
        tokio::time::sleep(RESTORE_DELAY).await;

        let instances = self.instances.read().await.clone();
        for instance in instances {
            if stored.get(&instance.uuid) != Some(&ContainerState::Running)
                && instance.container_state().await == ContainerState::Running
            {
                instance.persist_state(ContainerState::Running).await;
            }
        }
    }

    pub async fn instance(&self, uuid: Uuid) -> Option<Instance> {
        self.instances
            .read()
            .await
            .iter()
            .find(|instance| instance.uuid == uuid)
            .cloned()
    }

    pub async fn spawn_instance(&self, create: StoredInstanceCreate) -> anyhow::Result<Instance> {
        let stored = data::insert_instance(self.store.write(), create).await?;
        let uuid = stored.uuid;

        let instance = Instance::new(self.clone(), stored);
        if let Err(err) = instance.create_container().await {
            drop(instance);
            if let Err(cleanup) = data::delete_instance(self.store.write(), uuid).await {
                tracing::error!(instance = %uuid, "failed to roll back the stored instance: {cleanup}");
            }
            return Err(err);
        }

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
                && err.kind() != io::ErrorKind::NotFound
            {
                tracing::warn!(instance = %instance.uuid, "failed to remove {}: {err}", directory.display());
            }
        }

        data::delete_instance(self.store.write(), instance.uuid).await?;
        self.routes.mariadb_versions.remove(instance.uuid);
        self.instances
            .write()
            .await
            .retain(|candidate| candidate.uuid != instance.uuid);

        Ok(())
    }
}
