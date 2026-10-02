use chrono::{DateTime, Utc};
use core::fmt::{Display, Formatter};
use core::str::FromStr;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use url::Url;
use utoipa::ToSchema;
use uuid::Uuid;

pub const DATABASE_NAME_MIN_LENGTH: usize = 1;
pub const DATABASE_NAME_MAX_LENGTH: usize = 63;

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Mariadb,
    Mongodb,
    Postgres,
    Redis,
}

impl DatabaseType {
    pub const ALL: &'static [Self] = &[Self::Postgres, Self::Mariadb, Self::Mongodb, Self::Redis];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Mariadb => "mariadb",
            Self::Mongodb => "mongodb",
            Self::Postgres => "postgres",
            Self::Redis => "redis",
        }
    }

    #[must_use]
    pub const fn default_port(self) -> u16 {
        match self {
            Self::Mariadb => 3306,
            Self::Mongodb => 27017,
            Self::Postgres => 5432,
            Self::Redis => 6379,
        }
    }

    #[must_use]
    pub const fn uri_scheme(self) -> &'static str {
        match self {
            Self::Mariadb => "mysql",
            Self::Mongodb => "mongodb",
            Self::Postgres => "postgresql",
            Self::Redis => "redis",
        }
    }

    #[must_use]
    pub const fn has_named_databases(self) -> bool {
        !matches!(self, Self::Redis)
    }
}

impl Display for DatabaseType {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for DatabaseType {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|kind| kind.as_str() == value)
            .ok_or(())
    }
}

#[must_use]
pub fn validate_database_name(value: &str) -> bool {
    (DATABASE_NAME_MIN_LENGTH..=DATABASE_NAME_MAX_LENGTH).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseAccess {
    Read,
    Write,
}

impl DatabaseAccess {
    pub const ALL: &'static [Self] = &[Self::Read, Self::Write];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
        }
    }

    #[must_use]
    pub const fn is_write(self) -> bool {
        matches!(self, Self::Write)
    }
}

impl Display for DatabaseAccess {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for DatabaseAccess {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|access| access.as_str() == value)
            .ok_or(())
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct UserGrant {
    pub database_uuid: Uuid,
    pub access: DatabaseAccess,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ContainerState {
    #[default]
    Offline,
    Running,
    Starting,
    Stopping,
}

impl ContainerState {
    pub const ALL: &'static [Self] =
        &[Self::Offline, Self::Running, Self::Starting, Self::Stopping];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Offline => "offline",
            Self::Running => "running",
            Self::Starting => "starting",
            Self::Stopping => "stopping",
        }
    }
}

impl FromStr for ContainerState {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|state| state.as_str() == value)
            .ok_or(())
    }
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct ResourceUsage {
    pub cpu_absolute: f64,
    pub disk_bytes: u64,
    pub memory_bytes: u64,
    pub memory_limit_bytes: u64,
    pub state: ContainerState,
    pub uptime: u64,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PowerAction {
    Kill,
    Restart,
    Start,
    Stop,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct VolumeMapping(pub BTreeMap<String, String>);

impl VolumeMapping {
    pub fn entries(&self) -> impl Iterator<Item = VolumeMappingEntry<'_>> {
        self.0
            .iter()
            .map(|(host_name, container_path)| VolumeMappingEntry {
                container_path,
                host_name,
            })
    }
}

pub struct VolumeMappingEntry<'a> {
    container_path: &'a str,
    host_name: &'a str,
}

impl VolumeMappingEntry<'_> {
    #[must_use]
    pub fn host_path(&self, data_dir: &Path) -> PathBuf {
        let mut path = data_dir.join("volumes");
        path.extend(Path::new(self.host_name).components().filter_map(
            |component| match component {
                Component::Normal(part) => Some(part),
                _ => None,
            },
        ));
        path
    }

    #[must_use]
    pub fn container_path(&self) -> &Path {
        Path::new(self.container_path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StoredInstance {
    pub uuid: Uuid,
    pub uuid_short: i64,
    pub database_type: DatabaseType,
    pub suspended: bool,
    pub memory: i64,
    pub swap: i64,
    pub disk: i64,
    pub io_weight: Option<i64>,
    pub cpu: f64,
    pub image: String,
    pub image_uid: u32,
    pub image_gid: u32,
    pub volumes: VolumeMapping,
    pub socket_path: String,
    pub timezone: Option<String>,
    pub env: BTreeMap<String, String>,
    pub cmd: Option<Vec<String>>,
    #[serde(skip)]
    pub root_password: Option<String>,
    pub created: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StoredInstanceCreate {
    pub database_type: DatabaseType,
    #[serde(default)]
    pub suspended: bool,
    pub memory: i64,
    pub swap: i64,
    pub disk: i64,
    #[serde(default)]
    pub io_weight: Option<i64>,
    pub cpu: f64,
    pub image: String,
    pub image_uid: u32,
    pub image_gid: u32,
    #[serde(default)]
    pub volumes: VolumeMapping,
    pub socket_path: String,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cmd: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct StoredInstanceUpdate {
    pub suspended: Option<bool>,
    pub memory: Option<i64>,
    pub swap: Option<i64>,
    pub disk: Option<i64>,
    pub io_weight: Option<Option<i64>>,
    pub cpu: Option<f64>,
    pub image: Option<String>,
    pub image_uid: Option<u32>,
    pub image_gid: Option<u32>,
    pub volumes: Option<VolumeMapping>,
    pub socket_path: Option<String>,
    pub timezone: Option<Option<String>>,
    pub env: Option<BTreeMap<String, String>>,
    pub cmd: Option<Option<Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ApiInstance {
    #[serde(flatten)]
    pub data: StoredInstance,
    pub backend_auth_error: Option<String>,
    pub database_count: i64,
    pub utilization: ResourceUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StoredDatabase {
    pub uuid: Uuid,
    pub instance_uuid: Uuid,
    pub name: String,
    pub created: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StoredUser {
    pub uuid: Uuid,
    pub uuid_short: i64,
    pub instance_uuid: Uuid,
    pub grants: Vec<UserGrant>,
    pub username: String,
    pub password: String,
    pub created: DateTime<Utc>,
}

impl StoredUser {
    #[must_use]
    pub fn access(&self, database: Uuid) -> Option<DatabaseAccess> {
        self.grants
            .iter()
            .find(|grant| grant.database_uuid == database)
            .map(|grant| grant.access)
    }
}

impl StoredUser {
    #[must_use]
    pub fn identifier(&self) -> String {
        format!("u{:08x}_{}", self.uuid.as_fields().0, self.username)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct SubsystemConnectionCounts {
    pub total: usize,
    pub unique_databases: usize,
    pub unique_users: usize,
}

#[derive(Debug, Copy, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct SubsystemStatus {
    pub connections: SubsystemConnectionCounts,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SystemStatus {
    pub version: String,
    #[serde(default)]
    pub api_hash: String,
    pub uptime: u64,
    pub instance_count: usize,
    pub subsystems: BTreeMap<String, SubsystemStatus>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AgentRegistrationRequest {
    pub cert: Vec<u8>,
    pub csr: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SetupAgentConfig {
    pub base_url: Url,
    #[serde(default)]
    pub ports: HashMap<DatabaseType, u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BackendAgentConfig {
    pub base_url: Url,
    pub ports: HashMap<DatabaseType, u16>,
}
