use core::net::SocketAddr;
use database_agent_common::types::DatabaseType;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use uuid::Uuid;

fn default_data_dir() -> PathBuf {
    PathBuf::from("/var/lib/novium-database-agent/data")
}

fn default_socket_dir() -> PathBuf {
    PathBuf::from("/run/novium-database-agent")
}

const fn default_disk_check_interval() -> u64 {
    60
}

const fn default_disk_check_concurrency() -> usize {
    5
}

fn default_store_url() -> String {
    "sqlite:///var/lib/novium-database-agent/data/agent.db?mode=rwc".to_owned()
}

fn default_docker_socket() -> String {
    "/var/run/docker.sock".to_owned()
}

const fn default_tmpfs_size() -> u64 {
    100
}

const fn default_container_pid_limit() -> i64 {
    512
}

fn default_log_driver() -> String {
    "local".to_owned()
}

fn default_log_options() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("max-size".to_owned(), "5m".to_owned()),
        ("max-file".to_owned(), "1".to_owned()),
        ("compress".to_owned(), "false".to_owned()),
    ])
}

fn default_api_bind() -> SocketAddr {
    SocketAddr::from(([0, 0, 0, 0], 8090))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(default)]
    pub debug: bool,
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,
    #[serde(default = "default_socket_dir")]
    pub socket_dir: PathBuf,
    #[serde(default = "default_disk_check_interval")]
    pub disk_check_interval: u64,
    #[serde(default = "default_disk_check_concurrency")]
    pub disk_check_concurrency: usize,

    pub api: ApiConfig,
    #[serde(default)]
    pub store: StoreConfig,
    #[serde(default)]
    pub docker: DockerConfig,

    #[serde(default = "SubsystemConfig::postgres")]
    pub postgres: SubsystemConfig,
    #[serde(default = "SubsystemConfig::mariadb")]
    pub mariadb: SubsystemConfig,
    #[serde(default = "SubsystemConfig::mongodb")]
    pub mongodb: SubsystemConfig,
    #[serde(default = "SubsystemConfig::redis")]
    pub redis: SubsystemConfig,
}

impl AgentConfig {
    #[must_use]
    pub fn socket_dir(&self, instance: Uuid) -> PathBuf {
        self.socket_dir.join(instance.to_string())
    }

    #[must_use]
    pub fn data_dir(&self, instance: Uuid) -> PathBuf {
        self.data_dir.join(instance.to_string())
    }

    #[must_use]
    pub const fn subsystem(&self, kind: DatabaseType) -> &SubsystemConfig {
        match kind {
            DatabaseType::Mariadb => &self.mariadb,
            DatabaseType::Mongodb => &self.mongodb,
            DatabaseType::Postgres => &self.postgres,
            DatabaseType::Redis => &self.redis,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    pub token: String,
    #[serde(default = "default_api_bind")]
    pub bind: SocketAddr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreConfig {
    #[serde(default = "default_store_url")]
    pub url: String,
}

impl Default for StoreConfig {
    fn default() -> Self {
        Self {
            url: default_store_url(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubsystemConfig {
    #[serde(default)]
    pub enabled: bool,
    pub bind: SocketAddr,
}

impl SubsystemConfig {
    fn new(kind: DatabaseType) -> Self {
        Self {
            enabled: true,
            bind: SocketAddr::from(([0, 0, 0, 0], kind.default_port())),
        }
    }

    fn postgres() -> Self {
        Self::new(DatabaseType::Postgres)
    }

    fn mariadb() -> Self {
        Self::new(DatabaseType::Mariadb)
    }

    fn mongodb() -> Self {
        Self::new(DatabaseType::Mongodb)
    }

    fn redis() -> Self {
        Self::new(DatabaseType::Redis)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerConfig {
    #[serde(default = "default_docker_socket")]
    pub socket: String,
    #[serde(default)]
    pub registries: HashMap<String, DockerRegistry>,
    #[serde(default = "default_tmpfs_size")]
    pub tmpfs_size: u64,
    #[serde(default = "default_container_pid_limit")]
    pub container_pid_limit: i64,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub userns_mode: Option<String>,
    #[serde(default)]
    pub rootless: bool,
    #[serde(default = "default_log_driver")]
    pub log_driver: String,
    #[serde(default = "default_log_options")]
    pub log_options: BTreeMap<String, String>,
}

impl Default for DockerConfig {
    fn default() -> Self {
        Self {
            socket: default_docker_socket(),
            registries: HashMap::new(),
            tmpfs_size: default_tmpfs_size(),
            container_pid_limit: default_container_pid_limit(),
            timezone: None,
            userns_mode: None,
            rootless: false,
            log_driver: default_log_driver(),
            log_options: default_log_options(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerRegistry {
    pub username: String,
    pub password: String,
}
