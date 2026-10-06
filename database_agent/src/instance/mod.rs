pub mod connection;
pub mod disk_checker;
pub mod docker;
pub mod manager;
pub mod mariadb_version;

use crate::state::Agent;
use crate::store::data;
use crate::utils::generate_password;
use anyhow::Context as _;
use connection::{Connection, DatabaseGrant};
use core::ops::Deref;
use core::sync::atomic::{AtomicU64, Ordering};
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::{
    ApiInstance, ContainerState, DatabaseType, ResourceUsage, StoredDatabase, StoredInstance,
    StoredInstanceUpdate, StoredUser, UserGrant, validate_database_name,
};
use docker::{DockerHandle, ExecOptions};
use futures_util::StreamExt as _;
use manager::RouteInserter;
use sqlx::SqliteConnection;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use tokio::io::{AsyncRead, AsyncWriteExt as _};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

const MARIADB_DEFINER_STRIP: &str = r"sed -e 's/DEFINER=`[^`]*`@`[^`]*`//g'";

pub struct InnerInstance {
    pub uuid: Uuid,
    pub agent: Agent,

    pub data: RwLock<StoredInstance>,
    pub handle: RwLock<Option<Arc<DockerHandle>>>,
    pub backend_auth_error: RwLock<Option<String>>,
    pub disk_usage: AtomicU64,

    route_inserter: RouteInserter,
    power_lock: Mutex<()>,
    disk_checker_task: JoinHandle<()>,
    mariadb_version_task: Option<JoinHandle<()>>,
}

impl Drop for InnerInstance {
    fn drop(&mut self) {
        self.disk_checker_task.abort();
        if let Some(task) = &self.mariadb_version_task {
            task.abort();
        }
    }
}

#[derive(Clone)]
pub struct Instance(pub Arc<InnerInstance>);

impl Deref for Instance {
    type Target = InnerInstance;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Instance {
    pub fn new(agent: Agent, data: StoredInstance) -> Self {
        Self(Arc::new_cyclic(|weak| InnerInstance {
            uuid: data.uuid,
            route_inserter: agent.routes.inserter(Weak::clone(weak), data.database_type),
            disk_checker_task: tokio::spawn(disk_checker::run(Weak::clone(weak))),
            mariadb_version_task: (data.database_type == DatabaseType::Mariadb)
                .then(|| tokio::spawn(mariadb_version::run(Weak::clone(weak)))),
            agent,
            data: RwLock::new(data),
            handle: RwLock::new(None),
            backend_auth_error: RwLock::new(None),
            disk_usage: AtomicU64::new(0),
            power_lock: Mutex::new(()),
        }))
    }

    pub async fn socket_path(&self) -> PathBuf {
        let data = self.data.read().await;
        let file_name = data
            .socket_path
            .rsplit('/')
            .next()
            .unwrap_or(&data.socket_path)
            .to_owned();
        drop(data);

        self.agent.config.socket_dir(self.uuid).join(file_name)
    }

    pub async fn database_type(&self) -> DatabaseType {
        self.data.read().await.database_type
    }

    pub async fn is_suspended(&self) -> bool {
        self.data.read().await.suspended
    }

    pub async fn container_state(&self) -> ContainerState {
        self.handle
            .read()
            .await
            .as_ref()
            .map_or(ContainerState::Offline, |handle| handle.state())
    }

    pub async fn resource_usage(&self) -> ResourceUsage {
        self.handle.read().await.as_ref().map_or_else(
            || ResourceUsage {
                disk_bytes: self.disk_usage.load(Ordering::Relaxed),
                ..Default::default()
            },
            |handle| handle.resource_usage(&self.disk_usage),
        )
    }

    pub async fn to_api_response(&self) -> anyhow::Result<ApiInstance> {
        Ok(ApiInstance {
            data: self.data.read().await.clone(),
            backend_auth_error: self.backend_auth_error.read().await.clone(),
            database_count: data::database_count(self.agent.store.read(), self.uuid).await?,
            utilization: self.resource_usage().await,
        })
    }

    async fn require_online(&self, action: &str) -> anyhow::Result<()> {
        if self.database_type().await != DatabaseType::Redis
            && self.container_state().await != ContainerState::Running
        {
            anyhow::bail!("the instance must be online to {action}");
        }

        Ok(())
    }

    pub async fn verify_mongodb_auth(&self) -> anyhow::Result<()> {
        let result = self.verify_mongodb_auth_inner().await;
        *self.backend_auth_error.write().await = result.as_ref().err().map(ToString::to_string);
        result
    }

    async fn verify_mongodb_auth_inner(&self) -> anyhow::Result<()> {
        let conn = connection::mongodb::MongodbConnection::new(self.socket_path().await, None)?;
        let enforced = conn.auth_enforced().await?;

        if let Err(err) = self.ensure_mongodb_root().await {
            if enforced {
                anyhow::bail!(
                    "authorization is enforced but the agent has no root credentials: {err}"
                );
            }
            return Err(err);
        }

        if !enforced {
            anyhow::bail!("mongod does not enforce authorization, add --auth and restart");
        }

        Ok(())
    }

    pub async fn ensure_mongodb_root(&self) -> anyhow::Result<()> {
        let socket = self.socket_path().await;
        let mut data = self.data.write().await;

        let result = async {
            if data.root_password.is_some() {
                return Ok(());
            }

            let password = generate_password();
            let mut tx = self.agent.store.begin().await?;
            data::set_root_password(&mut *tx, self.uuid, &password).await?;
            connection::mongodb::MongodbConnection::new(socket, None)?
                .create_root(&password)
                .await?;
            tx.commit().await?;

            data.root_password = Some(password);

            Ok(())
        }
        .await;
        drop(data);

        result
    }

    pub async fn resync_users(&self) -> anyhow::Result<()> {
        self.route_inserter.clear();

        for user in data::users(&mut *self.agent.store.read().acquire().await?, self.uuid).await? {
            match identifier(&user) {
                Ok(identifier) => self.route_inserter.insert(identifier, user.password),
                Err(err) => tracing::warn!(
                    instance = %self.uuid,
                    "skipping user {}: {err}",
                    user.username
                ),
            }
        }

        Ok(())
    }

    pub async fn create_database(&self, name: &str) -> anyhow::Result<StoredDatabase> {
        if !validate_database_name(name) {
            anyhow::bail!("invalid database name");
        }
        self.require_online("create a database").await?;

        let mut tx = self.agent.store.begin().await?;
        let database = data::insert_database(&mut *tx, self.uuid, name).await?;
        self.connection().await?.create_database(name).await?;
        tx.commit().await?;

        Ok(database)
    }

    pub async fn delete_database(&self, database: &StoredDatabase) -> anyhow::Result<()> {
        self.require_online("delete a database").await?;

        let connection = self.connection().await?;
        let mut tx = self.agent.store.begin().await?;
        let revoked: Vec<UserIdentifier> = self
            .database_grants(&mut tx, database)
            .await?
            .into_iter()
            .map(|grant| grant.user)
            .collect();

        data::delete_database(&mut *tx, database.uuid).await?;
        connection
            .sync_grants(&database.name, &[], &revoked)
            .await?;
        connection.delete_database(&database.name).await?;
        tx.commit().await?;

        Ok(())
    }

    pub async fn recreate_database(&self, database: &StoredDatabase) -> anyhow::Result<()> {
        self.require_online("recreate a database").await?;

        let grants = self
            .database_grants(&mut *self.agent.store.read().acquire().await?, database)
            .await?;

        self.connection()
            .await?
            .recreate_database(&database.name, &grants)
            .await
    }

    async fn database_grants(
        &self,
        store: &mut SqliteConnection,
        database: &StoredDatabase,
    ) -> anyhow::Result<Vec<DatabaseGrant>> {
        data::database_users(store, self.uuid, database.uuid)
            .await?
            .iter()
            .filter_map(|user| {
                user.access(database.uuid)
                    .map(|access| (identifier(user), access))
            })
            .map(|(user, access)| {
                Ok(DatabaseGrant {
                    user: user?,
                    access,
                })
            })
            .collect()
    }

    async fn sync_grants(
        &self,
        store: &mut SqliteConnection,
        connection: &Connection,
        user: &StoredUser,
        previous: &[UserGrant],
    ) -> anyhow::Result<()> {
        let databases = data::databases(&mut *store, self.uuid).await?;
        let identifier = identifier(user)?;

        let mut affected: Vec<Uuid> = user
            .grants
            .iter()
            .chain(previous)
            .map(|grant| grant.database_uuid)
            .collect();
        affected.sort_unstable();
        affected.dedup();

        for uuid in affected {
            let Some(database) = databases.iter().find(|database| database.uuid == uuid) else {
                continue;
            };

            let grants = self.database_grants(store, database).await?;
            let revoked = match user.access(uuid) {
                Some(_) => Vec::new(),
                None => vec![identifier],
            };

            connection
                .sync_grants(&database.name, &grants, &revoked)
                .await?;
        }

        Ok(())
    }

    pub async fn database_size(&self, database: &StoredDatabase) -> anyhow::Result<i64> {
        self.require_online("read a database size").await?;

        self.connection().await?.database_size(&database.name).await
    }

    pub async fn create_user(
        &self,
        username: &str,
        grants: &[UserGrant],
    ) -> anyhow::Result<StoredUser> {
        self.require_online("create a user").await?;

        let connection = self.connection().await?;
        let password = generate_password();

        let mut tx = self.agent.store.begin().await?;
        let user = data::insert_user(&mut tx, self.uuid, username, &password, grants).await?;
        let identifier = identifier(&user)?;

        connection.create_user(&identifier, &password).await?;

        if let Err(err) = self.sync_grants(&mut tx, &connection, &user, &[]).await {
            if let Err(cleanup) = connection.delete_user(&identifier, &[]).await {
                tracing::error!(instance = %self.uuid, "failed to roll back user {identifier}: {cleanup}");
            }
            return Err(err);
        }

        tx.commit().await?;

        self.route_inserter.insert(identifier, password);

        Ok(user)
    }

    pub async fn set_grants(
        &self,
        user: &StoredUser,
        grants: &[UserGrant],
    ) -> anyhow::Result<StoredUser> {
        self.require_online("change a user's grants").await?;

        let connection = self.connection().await?;

        let mut tx = self.agent.store.begin().await?;
        data::replace_grants(&mut tx, user.uuid, grants).await?;

        let updated = StoredUser {
            grants: grants.to_vec(),
            ..user.clone()
        };

        self.sync_grants(&mut tx, &connection, &updated, &user.grants)
            .await?;
        tx.commit().await?;

        Ok(updated)
    }

    pub async fn rotate_password(&self, user: &StoredUser) -> anyhow::Result<String> {
        self.require_online("rotate a password").await?;

        let password = generate_password();
        let identifier = identifier(user)?;

        let mut tx = self.agent.store.begin().await?;
        data::set_user_password(&mut *tx, user.uuid, &password).await?;
        self.connection()
            .await?
            .update_user_password(&identifier, &password)
            .await?;
        tx.commit().await?;

        self.route_inserter.remove(&identifier);
        self.route_inserter.insert(identifier, password.as_str());

        Ok(password)
    }

    pub async fn delete_user(&self, user: &StoredUser) -> anyhow::Result<()> {
        self.require_online("delete a user").await?;

        let identifier = identifier(user)?;
        let databases = data::databases(self.agent.store.read(), self.uuid).await?;
        let granted: Vec<String> = user
            .grants
            .iter()
            .filter_map(|grant| {
                databases
                    .iter()
                    .find(|database| database.uuid == grant.database_uuid)
                    .map(|database| database.name.clone())
            })
            .collect();

        let mut tx = self.agent.store.begin().await?;
        data::delete_user(&mut *tx, user.uuid).await?;
        self.connection()
            .await?
            .delete_user(&identifier, &granted)
            .await?;
        tx.commit().await?;

        self.route_inserter.remove(&identifier);

        Ok(())
    }

    pub async fn create_container(&self) -> anyhow::Result<()> {
        if self.handle.read().await.is_some() {
            return Ok(());
        }

        let data = self.data.read().await.clone();
        let handle = DockerHandle::create(&self.agent.docker, &self.agent.config, &data).await?;
        *self.handle.write().await = Some(Arc::new(handle));

        Ok(())
    }

    pub async fn attach_container(&self) {
        if self.handle.read().await.is_some() {
            return;
        }

        if let Some(handle) =
            DockerHandle::attach(&self.agent.docker, &self.agent.config, self.uuid).await
        {
            *self.handle.write().await = Some(Arc::new(handle));
        }
    }

    pub async fn destroy_container(&self) -> anyhow::Result<()> {
        DockerHandle::destroy(&self.agent.docker, self.uuid).await?;
        self.handle.write().await.take();

        Ok(())
    }

    pub async fn update(&self, update: StoredInstanceUpdate) -> anyhow::Result<()> {
        let mut data = self.data.write().await;
        let mut updated = data.clone();
        data::apply_update(&mut updated, update);

        let mut tx = self.agent.store.begin().await?;
        data::update_instance(&mut *tx, &updated).await?;
        let handle = self.handle.read().await.clone();
        if let Some(handle) = handle {
            handle.update_resources(&updated).await?;
        }
        tx.commit().await?;

        *data = updated;
        drop(data);

        Ok(())
    }

    pub async fn start(&self) -> anyhow::Result<()> {
        if self.is_disk_full().await {
            anyhow::bail!("the instance is over its disk limit");
        }
        if self.is_suspended().await {
            anyhow::bail!("the instance is suspended");
        }

        let guard = self.power_lock.lock().await;

        self.destroy_container().await?;
        self.create_container().await?;

        let handle = self.handle.read().await.clone();
        let result = match handle {
            Some(handle) => handle.start().await,
            None => Err(anyhow::anyhow!("the instance has no container")),
        };
        if result.is_ok() {
            self.persist_state(ContainerState::Running).await;
        }
        drop(guard);

        result
    }

    pub async fn persist_state(&self, state: ContainerState) {
        if let Err(err) = data::set_instance_state(self.agent.store.write(), self.uuid, state).await
        {
            tracing::error!(instance = %self.uuid, "failed to persist the instance state: {err:#}");
        }
    }

    pub async fn stop(&self) -> anyhow::Result<()> {
        let guard = self.power_lock.lock().await;
        let handle = self.handle.read().await.clone();
        let result = match handle {
            Some(handle) => handle.stop().await,
            None => Ok(()),
        };
        if result.is_ok() {
            self.persist_state(ContainerState::Offline).await;
        }
        drop(guard);

        result
    }

    pub async fn kill(&self) -> anyhow::Result<()> {
        let guard = self.power_lock.lock().await;
        let handle = self.handle.read().await.clone();
        let result = match handle {
            Some(handle) => handle.kill().await,
            None => Ok(()),
        };
        if result.is_ok() {
            self.persist_state(ContainerState::Offline).await;
        }
        drop(guard);

        result
    }

    pub async fn logs(
        &self,
        lines: Option<usize>,
    ) -> futures_util::stream::BoxStream<'static, anyhow::Result<bytes::Bytes>> {
        self.handle.read().await.as_ref().map_or_else(
            || futures_util::stream::empty().boxed(),
            |handle| handle.logs(lines),
        )
    }

    async fn exec(&self, options: ExecOptions) -> anyhow::Result<docker::ExecStream> {
        let handle = self.handle.read().await.clone();

        match handle {
            Some(handle) => handle.exec(options).await,
            None => Err(anyhow::anyhow!("the instance has no container")),
        }
    }

    #[expect(
        clippy::option_if_let_else,
        reason = "the command templates read better as a match"
    )]
    pub async fn export(
        &self,
        database: Option<&str>,
    ) -> anyhow::Result<Box<dyn AsyncRead + Send + Unpin>> {
        self.require_online("export").await?;

        let data = self.data.read().await;
        let socket = data.socket_path.clone();
        let directory = socket.rsplit_once('/').map_or("", |(head, _)| head);

        let command = match data.database_type {
            DatabaseType::Postgres => match database {
                Some(database) => format!(
                    "pg_dump --no-owner --no-privileges -h '{directory}' -U postgres '{database}'"
                ),
                None => {
                    format!("pg_dumpall --no-owner --no-privileges -h '{directory}' -U postgres")
                }
            },
            DatabaseType::Mariadb => match database {
                Some(database) => {
                    format!(
                        "mariadb-dump --socket='{socket}' -u root '{database}' | {MARIADB_DEFINER_STRIP}"
                    )
                }
                None => {
                    format!(
                        "mariadb-dump --socket='{socket}' -u root --all-databases | {MARIADB_DEFINER_STRIP}"
                    )
                }
            },
            DatabaseType::Mongodb => {
                let auth = mongodb_shell_auth(&data);
                match database {
                    Some(database) => {
                        format!("mongodump --host='{socket}'{auth} --archive -d '{database}'")
                    }
                    None => format!("mongodump --host='{socket}'{auth} --archive"),
                }
            }
            DatabaseType::Redis => format!("redis-cli -s '{socket}' --rdb -"),
        };
        drop(data);

        let stream = self
            .exec(ExecOptions::shell(format!("{command} 2>/dev/null")))
            .await?;

        Ok(Box::new(tokio_util::io::StreamReader::new(
            stream
                .output
                .map(|chunk| chunk.map_err(std::io::Error::other)),
        )))
    }

    #[expect(
        clippy::option_if_let_else,
        reason = "the command templates read better as a match"
    )]
    pub async fn import(
        &self,
        database: Option<&str>,
        wipe: bool,
        reader: &mut (dyn AsyncRead + Send + Unpin),
    ) -> anyhow::Result<()> {
        self.require_online("import").await?;

        let data = self.data.read().await;
        let socket = data.socket_path.clone();
        let directory = socket.rsplit_once('/').map_or("", |(head, _)| head);

        if wipe && database.is_none() && data.database_type != DatabaseType::Redis {
            anyhow::bail!("wiping requires a target database");
        }

        let (wipe_command, command) = match data.database_type {
            DatabaseType::Postgres => match database {
                Some(database) => {
                    let strip = r"sed '/^COPY .*FROM stdin;$/,/^\\\.$/!{ s/^\\connect .*$//; s/^\\c .*$//; s/^CREATE DATABASE .*;$//; s/^DROP DATABASE .*;$//; s/^ALTER DATABASE .*;$//; }' |";
                    let base = format!(
                        "psql -q -v ON_ERROR_STOP=1 -h '{directory}' -U postgres -d '{database}'"
                    );
                    let wipe = wipe.then(|| {
                        format!("{base} -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'")
                    });
                    (wipe, format!("{strip} {base} -o /dev/null"))
                }
                None => (
                    None,
                    format!("psql -q -h '{directory}' -U postgres -d postgres -o /dev/null"),
                ),
            },
            DatabaseType::Mariadb => match database {
                Some(database) => {
                    let redirect = r" -e '/^DELIMITER ;;$/,/^DELIMITER ;$/!{ s/^USE `[^`]*`;$//; s/^CREATE DATABASE .*;$//; s/^DROP DATABASE .*;$//; s|^/\*![0-9]* DROP DATABASE .*;$||; }'";
                    let import = format!(
                        "{MARIADB_DEFINER_STRIP}{redirect} | mariadb --socket='{socket}' -u root '{database}'"
                    );
                    let wipe = wipe.then(|| {
                        format!(
                            "mariadb --socket='{socket}' -u root -e \
                             'DROP DATABASE IF EXISTS `{database}`; CREATE DATABASE `{database}`;'"
                        )
                    });
                    (wipe, import)
                }
                None => (
                    None,
                    format!("{MARIADB_DEFINER_STRIP} | mariadb --socket='{socket}' -u root"),
                ),
            },
            DatabaseType::Mongodb => {
                let auth = mongodb_shell_auth(&data);
                let drop_existing = if wipe { " --drop" } else { "" };
                let import = match database {
                    Some(database) => format!(
                        "mongorestore --host='{socket}'{auth} --archive{drop_existing} -d '{database}'"
                    ),
                    None => {
                        format!("mongorestore --host='{socket}'{auth} --archive{drop_existing}")
                    }
                };
                (None, import)
            }
            DatabaseType::Redis => {
                if database.is_some() {
                    anyhow::bail!("redis has no named databases");
                }
                let wipe = wipe.then(|| format!("redis-cli -s '{socket}' FLUSHALL"));
                (wipe, format!("redis-cli -s '{socket}' --pipe"))
            }
        };
        drop(data);

        if let Some(wipe_command) = wipe_command {
            let mut stream = self.exec(ExecOptions::shell(wipe_command)).await?;
            drop(stream.stdin);
            while let Some(chunk) = stream.output.next().await {
                chunk?;
            }
        }

        let docker::ExecStream {
            mut output,
            mut stdin,
        } = self.exec(ExecOptions::shell(command)).await?;

        let write = async {
            tokio::io::copy(reader, &mut stdin).await?;
            stdin.shutdown().await?;
            Ok::<_, anyhow::Error>(())
        };
        let drain = async {
            let mut buffer = Vec::new();
            while let Some(chunk) = output.next().await {
                match chunk {
                    Ok(bytes) if buffer.len() < 8192 => buffer.extend_from_slice(&bytes),
                    Ok(_) => {}
                    Err(err) => {
                        let message = String::from_utf8_lossy(&buffer);
                        let message = message.trim();
                        return Err(if message.is_empty() {
                            err
                        } else {
                            anyhow::anyhow!("{err}: {message}")
                        });
                    }
                }
            }
            Ok::<_, anyhow::Error>(())
        };

        let mut write = core::pin::pin!(write);
        let mut drain = core::pin::pin!(drain);
        tokio::select! {
            drained = &mut drain => drained,
            written = &mut write => drain.await.and(written),
        }
    }

    pub async fn query(
        &self,
        database: Option<&str>,
        query: &str,
    ) -> anyhow::Result<database_agent_common::types::QueryResult> {
        self.require_online("run a query").await?;

        self.connection().await?.query(database, query).await
    }
}

fn identifier(user: &StoredUser) -> anyhow::Result<UserIdentifier> {
    UserIdentifier::from_parts(user.uuid.as_fields().0, &user.username)
        .with_context(|| format!("invalid identifier for user {}", user.username))
}

fn mongodb_shell_auth(data: &StoredInstance) -> String {
    data.root_password
        .as_deref()
        .map_or_else(String::new, |password| {
            format!(
                " -u {} -p '{password}' --authenticationDatabase admin",
                connection::mongodb::ROOT_USERNAME
            )
        })
}
