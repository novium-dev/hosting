mod config;
mod instance;
mod integrity;
mod service;
mod setup;
mod state;
mod store;
mod subsystems;
mod utils;

use crate::config::AgentConfig;
use crate::state::Agent;
use crate::store::Store;
use anyhow::Context as _;
use axum_server::Handle;
use clap::{Arg, ArgAction, ArgMatches, command, value_parser};
use core::time::Duration;
use std::env;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;
use zelus_keys::{DaemonKey, DaemonRootKey};

fn main() {
    let matches = command!()
        .about("novium database agent")
        .args_override_self(true)
        .arg(
            Arg::new("debug")
                .short('d')
                .long("debug")
                .env("DEBUG")
                .help("Enables debug output")
                .required(false)
                .action(ArgAction::SetTrue)
                .default_value(if cfg!(debug_assertions) {
                    "true"
                } else {
                    "false"
                }),
        )
        .arg(
            Arg::new("setup-url")
                .long("setup-url")
                .env("SETUP_URL")
                .help("Sets the URL to use for setup (Only relevant for setup)")
                .action(ArgAction::Set)
                .required(false),
        )
        .arg(
            Arg::new("setup-token")
                .long("setup-token")
                .env("SETUP_TOKEN")
                .help("Sets the token to use for setup (Only relevant for setup)")
                .action(ArgAction::Set)
                .required(false),
        )
        .arg(
            Arg::new("port")
                .long("port")
                .env("PORT")
                .help("Sets the port the api listens on (Only relevant for setup)")
                .action(ArgAction::Set)
                .required(false)
                .value_parser(value_parser!(u16))
                .default_value("8090"),
        )
        .get_matches();

    tracing_subscriber::registry()
        .with(tracing_subscriber::filter::LevelFilter::from_level(
            if matches.get_flag("debug") {
                tracing::Level::DEBUG
            } else {
                tracing::Level::INFO
            },
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Unable to install default crypto provider");

    main0(matches);
}

#[tokio::main]
async fn main0(matches: ArgMatches) {
    if let Err(err) = run(matches).await {
        tracing::error!("the database agent stopped: {err:?}");
    }
}

async fn run(matches: ArgMatches) -> anyhow::Result<()> {
    info!(
        "Starting Database Agent on version {}",
        env!("GIT_HASH").trim()
    );

    let data_dir =
        env::var_os("DATABASE_AGENT_DATA_DIR").map_or_else(|| PathBuf::from("."), PathBuf::from);

    if needs_setup(&data_dir).await? {
        let url = matches
            .get_one::<String>("setup-url")
            .context("setup-url is required for setup")?;
        let token = matches
            .get_one::<String>("setup-token")
            .context("setup-token is required for setup")?;
        let port = *matches
            .get_one::<u16>("port")
            .context("port is required for setup")?;

        return setup::setup(&data_dir, url, token, port).await;
    }

    let config: AgentConfig = {
        let path = data_dir.join(setup::CONFIG_FILE);
        let buffer = tokio::fs::read_to_string(&path)
            .await
            .with_context(|| format!("failed to read {}", path.display()))?;
        toml::from_str(&buffer).context("failed to parse the config file")?
    };

    let (root, key) = read_keys(&data_dir).await?;

    let config = Arc::new(config);
    let store = Store::open(&config).await?;
    let docker = instance::docker::connect(&config).await?;

    let agent = Agent::new(config, store, docker, root, key);
    agent.load_instances().await?;

    subsystems::spawn_all(&agent);

    let handle = Handle::new();
    agent.serve_http(handle.clone())?;

    info!("Ready");

    await_shutdown().await;

    info!("Shutting down");
    handle.graceful_shutdown(Some(service::SHUTDOWN_GRACE));

    let deadline = tokio::time::Instant::now() + service::SHUTDOWN_GRACE;
    while handle.connection_count() > 0 && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(1)).await;
        info!("Connections still alive: {}", handle.connection_count());
    }

    Ok(())
}

async fn needs_setup(data_dir: &Path) -> anyhow::Result<bool> {
    match tokio::fs::read_to_string(data_dir.join(setup::CONFIG_FILE)).await {
        Ok(contents) => Ok(contents.trim().is_empty()),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(true),
        Err(err) => Err(err).context("failed to read the config file"),
    }
}

async fn read_keys(data_dir: &Path) -> anyhow::Result<(Arc<DaemonRootKey>, Arc<DaemonKey>)> {
    let root_path = data_dir.join(setup::ROOT_KEY_FILE);
    let key_path = data_dir.join(setup::KEY_FILE);

    let root = tokio::fs::read(&root_path)
        .await
        .with_context(|| format!("failed to read {}", root_path.display()))?;
    let key = tokio::fs::read(&key_path)
        .await
        .with_context(|| format!("failed to read {}", key_path.display()))?;

    let root = DaemonRootKey::parse(&root)
        .with_context(|| format!("failed to parse {}", root_path.display()))?
        .0;
    let key = DaemonKey::parse(&root, &key)
        .with_context(|| format!("failed to parse {}", key_path.display()))?;

    Ok((Arc::new(root), Arc::new(key)))
}

async fn await_shutdown() {
    let mut interrupt = match signal(SignalKind::interrupt()) {
        Ok(signal) => signal,
        Err(err) => {
            warn!("unable to hook SIGINT: {err}");
            return;
        }
    };
    let mut terminate = match signal(SignalKind::terminate()) {
        Ok(signal) => signal,
        Err(err) => {
            warn!("unable to hook SIGTERM: {err}");
            return;
        }
    };

    tokio::select! {
        _ = interrupt.recv() => {}
        _ = terminate.recv() => {}
    }
}
