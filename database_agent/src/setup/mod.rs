use crate::config::{AgentConfig, ApiConfig, DockerConfig, StoreConfig, SubsystemConfig};
use crate::key::{AgentCertResolver, TlsAcceptor};
use crate::service::middleware;
use anyhow::Context as _;
use async_trait::async_trait;
use axum_server::Server;
use axum_server::tls_rustls::{RustlsAcceptor, RustlsConfig};
use core::net::SocketAddr;
use core::time::Duration;
use daemon_common::key::rcgen::{KeyPair, PKCS_ECDSA_P256_SHA256, PKCS_RSA_SHA256};
use daemon_common::key::{DaemonKey, DaemonRootKey};
use database_agent_common::service::framework_router;
use database_agent_common::service::setup::SetupService;
use database_agent_common::service::setup::setup_service_error::ConfigError;
use database_agent_common::types::{
    AgentRegistrationRequest, BackendAgentConfig, DatabaseType, SetupAgentConfig,
};
use reqwest::{Client, StatusCode};
use rustls::ServerConfig;
use rustls::pki_types::CertificateDer;
use rustls::server::WebPkiClientVerifier;
use std::path::Path;
use std::sync::Arc;
use tracing::{error, info, warn};
use url::Url;
use utoipa_axum::router::OpenApiRouter;

pub const ROOT_KEY_FILE: &str = "agent_root.pem";
pub const KEY_FILE: &str = "agent.pem";
pub const CONFIG_FILE: &str = "config.toml";

pub async fn setup(data_dir: &Path, url: &str, code: &str, port: u16) -> anyhow::Result<()> {
    info!("Starting Setup...");

    let backend = Url::parse(url).context("SETUP_URL is not a valid URL")?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("failed to build the setup http client")?;

    info!("Retrieving daemon root key...");
    let Some((root, rsa)) = read_root_key(&client, &backend, code).await? else {
        return Ok(());
    };
    let root = Arc::new(root);

    info!("Retrieving agent config...");
    let remote = read_config(&client, &backend, code).await?;
    let config = to_agent_config(&remote, port);

    let keypair = KeyPair::generate_for(if rsa {
        &PKCS_RSA_SHA256
    } else {
        &PKCS_ECDSA_P256_SHA256
    })
    .context("failed to generate key pair")?;

    let csr =
        DaemonKey::new_request(&keypair).context("failed to build certificate signing request")?;
    let temp_key =
        Arc::new(DaemonKey::new_temp(&keypair).context("failed to build temporary key")?);

    test_host(&config, &root, &temp_key).await?;

    let request = AgentRegistrationRequest {
        cert: temp_key
            .cert
            .first()
            .context("temporary key has at least one certificate")?
            .to_vec(),
        csr: csr.to_vec(),
    };

    let signed = client
        .post(
            backend
                .join("/api/internal/database_agent/register")
                .context("register endpoint url is valid")?,
        )
        .bearer_auth(code)
        .json(&request)
        .send()
        .await
        .context("failed to send registration request")?
        .error_for_status()
        .context("registration request returned an error status")?
        .bytes()
        .await
        .context("failed to read registration response body")?
        .to_vec();

    let key = DaemonKey::new(
        &root,
        CertificateDer::from(signed),
        temp_key.privkey.clone_key(),
    )
    .context("failed to build signed agent key")?;

    tokio::fs::write(
        data_dir.join(CONFIG_FILE),
        toml::to_string(&config).context("failed to serialize the agent config")?,
    )
    .await
    .context("failed to write config.toml")?;
    tokio::fs::write(data_dir.join(ROOT_KEY_FILE), root.dump(None, None))
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

async fn test_host(
    config: &AgentConfig,
    root: &Arc<DaemonRootKey>,
    key: &Arc<DaemonKey>,
) -> anyhow::Result<()> {
    #[derive(Clone)]
    struct ConnectionTestWrapper;

    #[async_trait]
    impl SetupService for ConnectionTestWrapper {
        async fn config(&self) -> Result<BackendAgentConfig, ConfigError> {
            Err(ConfigError::AwaitingSetup)
        }
    }

    let mut rustls = ServerConfig::builder()
        .with_client_cert_verifier(
            WebPkiClientVerifier::builder(Arc::clone(&root.cert_store))
                .allow_unauthenticated()
                .allow_unknown_revocation_status()
                .build()
                .context("failed to build client certificate verifier")?,
        )
        .with_cert_resolver(Arc::new(AgentCertResolver(Arc::clone(key))));
    rustls.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    let rustls = RustlsConfig::from_config(Arc::new(rustls));

    let (router,) =
        framework_router!(ConnectionTestWrapper ConnectionTestWrapper (default,) { SetupService });
    let router = OpenApiRouter::new()
        .merge(router.into_openapi())
        .layer(axum::middleware::from_fn(middleware));
    let (router, _) = router.split_for_parts();

    let bind = config.api.bind;
    info!("Starting temporary setup server on {bind}...");

    tokio::task::spawn(async move {
        let _ = Server::bind(bind)
            .acceptor(TlsAcceptor(RustlsAcceptor::new(rustls)))
            .serve(router.into_make_service())
            .await
            .inspect_err(|err| {
                error!("failed to serve the temporary setup server on {bind}: {err}");
            });
    });

    tokio::time::sleep(Duration::from_secs(5)).await;

    Ok(())
}

async fn read_root_key(
    client: &Client,
    url: &Url,
    code: &str,
) -> anyhow::Result<Option<(DaemonRootKey, bool)>> {
    let response = client
        .get(
            url.join("/api/internal/database_agent/root_key")
                .context("root_key endpoint url is valid")?,
        )
        .bearer_auth(code)
        .send()
        .await?;
    if response.status() == StatusCode::UNAUTHORIZED {
        warn!("Code is invalid");
        return Ok(None);
    }
    let rsa = response.headers().contains_key("X-Prefer-RSA-Key");
    let pem: String = response.error_for_status()?.json().await?;
    Ok(Some((DaemonRootKey::parse(pem)?.0, rsa)))
}

async fn read_config(client: &Client, url: &Url, code: &str) -> anyhow::Result<SetupAgentConfig> {
    Ok(client
        .get(
            url.join("/api/internal/database_agent/config")
                .context("config endpoint url is valid")?,
        )
        .bearer_auth(code)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}
