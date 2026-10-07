use crate::config::{AgentConfig, ApiConfig, DockerConfig, StoreConfig, SubsystemConfig};
use crate::service::middleware;
use anyhow::Context as _;
use async_trait::async_trait;
use core::net::SocketAddr;
use core::time::Duration;
use database_agent_common::AGENT_KEY_PREFIX;
use database_agent_common::service::framework_router;
use database_agent_common::service::setup::SetupService;
use database_agent_common::service::setup::setup_service_error::ConfigError;
use database_agent_common::types::{
    AgentRegistrationRequest, BackendAgentConfig, DatabaseType, SetupAgentConfig,
};
use reqwest::Client;
use std::path::Path;
use tracing::{info, warn};
use url::Url;
use utoipa_axum::router::OpenApiRouter;
use zelus_keys::setup::{PendingKey, SetupClient, serve_connection_test};

pub const ROOT_KEY_FILE: &str = "agent_root.pem";
pub const KEY_FILE: &str = "agent.pem";
pub const CONFIG_FILE: &str = "config.toml";

pub async fn setup(data_dir: &Path, url: &str, code: &str, port: u16) -> anyhow::Result<()> {
    info!("Starting Setup...");

    let backend = Url::parse(url).context("SETUP_URL is not a valid URL")?;
    let http = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("failed to build the setup http client")?;
    let client = SetupClient::new(http, &backend, "/api/internal/database_agent", code)?;

    info!("Retrieving daemon root key...");
    let Some(offer) = client.root_key().await? else {
        warn!("Code is invalid");
        return Ok(());
    };

    info!("Retrieving agent config...");
    let remote: SetupAgentConfig = client.config().await?;
    let config = to_agent_config(&remote, port);

    let pending = PendingKey::generate(offer.prefers_rsa, AGENT_KEY_PREFIX)?;

    info!("Starting temporary setup server on {}...", config.api.bind);
    serve_connection_test(
        [config.api.bind],
        &offer.root,
        &pending.temp,
        connection_test_router(),
    )
    .await?;

    let signed = client
        .register(&AgentRegistrationRequest {
            cert: pending.certificate().to_vec(),
            csr: pending.csr.to_vec(),
        })
        .await?;
    let key = pending.finish(&offer.root, signed)?;

    tokio::fs::write(
        data_dir.join(CONFIG_FILE),
        toml::to_string(&config).context("failed to serialize the agent config")?,
    )
    .await
    .context("failed to write config.toml")?;
    tokio::fs::write(data_dir.join(ROOT_KEY_FILE), offer.root.dump(None, None))
        .await
        .context("failed to write the root key")?;
    tokio::fs::write(data_dir.join(KEY_FILE), key.dump())
        .await
        .context("failed to write the agent key")?;

    info!("Done");

    Ok(())
}

fn to_agent_config(remote: &SetupAgentConfig, port: u16) -> AgentConfig {
    let subsystem = |kind: DatabaseType| SubsystemConfig {
        enabled: true,
        bind: SocketAddr::from((
            [0, 0, 0, 0],
            remote
                .ports
                .get(&kind)
                .copied()
                .unwrap_or_else(|| kind.default_port()),
        )),
    };

    AgentConfig {
        debug: false,
        data_dir: crate::config::default_data_dir(),
        socket_dir: crate::config::default_socket_dir(),
        disk_check_interval: crate::config::default_disk_check_interval(),
        disk_check_concurrency: crate::config::default_disk_check_concurrency(),
        boot_autostart_concurrency: crate::config::default_boot_autostart_concurrency(),
        api: ApiConfig {
            public_url: remote.base_url.clone(),
            bind: SocketAddr::from(([0, 0, 0, 0], port)),
        },
        store: StoreConfig::default(),
        docker: DockerConfig::default(),
        postgres: subsystem(DatabaseType::Postgres),
        mariadb: subsystem(DatabaseType::Mariadb),
        mongodb: subsystem(DatabaseType::Mongodb),
        redis: subsystem(DatabaseType::Redis),
    }
}

fn connection_test_router() -> axum::Router {
    #[derive(Clone)]
    struct ConnectionTestWrapper;

    #[async_trait]
    impl SetupService for ConnectionTestWrapper {
        async fn config(&self) -> Result<BackendAgentConfig, ConfigError> {
            Err(ConfigError::AwaitingSetup)
        }
    }

    let (router,) =
        framework_router!(ConnectionTestWrapper ConnectionTestWrapper (default,) { SetupService });
    OpenApiRouter::new()
        .merge(router.into_openapi())
        .layer(axum::middleware::from_fn(middleware))
        .split_for_parts()
        .0
}
