use crate::Backend;
use core::time::Duration;
use redis::AsyncCommands as _;
use redis::{ExistenceCheck, SetExpiry, SetOptions};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::postgres::PgListener;
use sqlx::{PgConnection, query};
use tokio_util::sync::{CancellationToken, DropGuard};
use tracing::{debug, error, warn};

const SYNC_CHANNEL: &str = "novium_sync";
const LISTEN_RETRY: Duration = Duration::from_secs(5);

pub(crate) const JOB_LOCK_TTL: Duration = Duration::from_mins(3);
const JOB_HEARTBEAT: Duration = Duration::from_mins(1);
pub(crate) const JOB_RETENTION: Duration = Duration::from_hours(168);

#[derive(Debug, Clone, Copy)]
pub(crate) enum SyncTarget {
    Nodes,
    DatabaseHosts,
}

impl SyncTarget {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Nodes => "nodes",
            Self::DatabaseHosts => "database_hosts",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "nodes" => Some(Self::Nodes),
            "database_hosts" => Some(Self::DatabaseHosts),
            _ => None,
        }
    }
}

fn cache_key(name: &str) -> String {
    format!("{}{name}", crate::CACHE_KEY_PREFIX)
}

impl Backend {
    pub(crate) async fn notify_sync(
        &self,
        conn: &mut PgConnection,
        target: SyncTarget,
    ) -> Result<(), sqlx::Error> {
        query!(
            "SELECT pg_notify($1, $2)",
            SYNC_CHANNEL,
            format!("{}:{}", self.instance, target.as_str())
        )
        .execute(conn)
        .await?;
        Ok(())
    }

    async fn reload(&self, target: Option<SyncTarget>) -> Result<(), sqlx::Error> {
        let mut conn = self.database.acquire().await?;
        match target {
            Some(SyncTarget::Nodes) => self.load_nodes(&mut conn).await,
            Some(SyncTarget::DatabaseHosts) => self.load_database_hosts(&mut conn).await,
            None => {
                self.load_nodes(&mut conn).await?;
                self.load_database_hosts(&mut conn).await
            }
        }
    }

    async fn listen_sync(&self) -> Result<(), sqlx::Error> {
        let mut listener = PgListener::connect(&self.config.database_url).await?;
        listener.listen(SYNC_CHANNEL).await?;
        self.reload(None).await?;

        loop {
            let Some(notification) = listener.try_recv().await? else {
                warn!("Lost the cluster sync connection, reloading everything");
                self.reload(None).await?;
                continue;
            };

            let Some((origin, target)) = notification.payload().split_once(':') else {
                continue;
            };
            if origin == self.instance.to_string() {
                continue;
            }
            let Some(target) = SyncTarget::parse(target) else {
                continue;
            };

            debug!("Reloading {} after a change on {origin}", target.as_str());
            self.reload(Some(target)).await?;
        }
    }

    pub(crate) fn spawn_cluster_sync(&self) {
        let backend = self.clone();
        tokio::task::spawn(async move {
            loop {
                if let Err(err) = backend.listen_sync().await {
                    error!("Cluster sync failed: {err:?}");
                }
                tokio::time::sleep(LISTEN_RETRY).await;
            }
        });
    }

    pub(crate) async fn try_lock(&self, name: &str, ttl: Duration) -> bool {
        let options = SetOptions::default()
            .conditional_set(ExistenceCheck::NX)
            .with_expiration(SetExpiry::EX(ttl.as_secs()));
        self.cache
            .clone()
            .set_options::<_, _, Option<String>>(
                cache_key(name),
                self.instance.to_string(),
                options,
            )
            .await
            .inspect_err(|err| error!("Unable to acquire the lock {name}: {err:?}"))
            .is_ok_and(|reply| reply.is_some())
    }

    pub(crate) async fn is_locked(&self, name: &str) -> bool {
        self.cache
            .clone()
            .exists::<_, bool>(cache_key(name))
            .await
            .inspect_err(|err| error!("Unable to check the lock {name}: {err:?}"))
            .unwrap_or(true)
    }

    pub(crate) async fn refresh_lock(&self, name: &str, ttl: Duration) {
        let _ = self
            .cache
            .clone()
            .expire::<_, bool>(cache_key(name), ttl.as_secs().cast_signed())
            .await
            .inspect_err(|err| error!("Unable to refresh the lock {name}: {err:?}"));
    }

    pub(crate) fn hold_lock(&self, name: String) -> DropGuard {
        let token = CancellationToken::new();
        let cancelled = token.clone();
        let backend = self.clone();
        tokio::task::spawn(async move {
            loop {
                tokio::select! {
                    () = cancelled.cancelled() => break,
                    () = tokio::time::sleep(JOB_HEARTBEAT) => {
                        backend.refresh_lock(&name, JOB_LOCK_TTL).await;
                    }
                }
            }
        });
        token.drop_guard()
    }

    pub(crate) async fn release_lock(&self, name: &str) {
        let _ = self
            .cache
            .clone()
            .del::<_, ()>(cache_key(name))
            .await
            .inspect_err(|err| error!("Unable to release the lock {name}: {err:?}"));
    }

    pub(crate) async fn store_shared<T: Serialize + Sync>(
        &self,
        name: &str,
        value: &T,
        ttl: Duration,
    ) {
        let raw = match serde_json::to_vec(value) {
            Ok(raw) => raw,
            Err(err) => {
                error!("Unable to serialize the shared state {name}: {err:?}");
                return;
            }
        };
        let _ = self
            .cache
            .clone()
            .set_ex::<_, _, ()>(cache_key(name), raw, ttl.as_secs())
            .await
            .inspect_err(|err| error!("Unable to store the shared state {name}: {err:?}"));
    }

    pub(crate) async fn load_shared<T: DeserializeOwned>(
        &self,
        name: &str,
    ) -> Result<Option<T>, redis::RedisError> {
        let Some(raw) = self
            .cache
            .clone()
            .get::<_, Option<Vec<u8>>>(cache_key(name))
            .await?
        else {
            return Ok(None);
        };
        Ok(serde_json::from_slice(&raw)
            .inspect_err(|err| warn!("Discarding unreadable shared state {name}: {err:?}"))
            .ok())
    }
}
