mod config;
mod instance;
mod integrity;
mod service;
mod state;
mod store;
mod subsystems;
mod utils;

use crate::config::AgentConfig;
use crate::state::Agent;
use crate::store::Store;
use anyhow::Context as _;
use axum_server::Handle;
use core::time::Duration;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;

fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::filter::LevelFilter::from_level(
            if cfg!(debug_assertions) || env::var("DEBUG").unwrap_or_default().eq("1") {
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

    main0();
}

#[tokio::main]
async fn main0() {
    if let Err(err) = run().await {
        tracing::error!("the database agent stopped: {err:?}");
    }
}

async fn run() -> anyhow::Result<()> {
    info!(
        "Starting Database Agent on version {}",
        env!("GIT_HASH").trim()
    );

    let data_dir =
        env::var_os("DATABASE_AGENT_DATA_DIR").map_or_else(|| PathBuf::from("."), PathBuf::from);

    let config: AgentConfig = {
        let path = data_dir.join("config.toml");
        let buffer = tokio::fs::read_to_string(&path)
            .await
            .with_context(|| format!("failed to read {}", path.display()))?;
        toml::from_str(&buffer).context("failed to parse the config file")?
    };

    if config.api.token.is_empty() {
        anyhow::bail!("the api token in the config file is empty");
    }

    let config = Arc::new(config);
    let store = Store::open(&config).await?;
    let docker = instance::docker::connect(&config).await?;

    let agent = Agent::new(config, store, docker);
    agent.load_instances().await?;

    subsystems::spawn_all(&agent);

    let handle = Handle::new();
    agent.serve_http(handle.clone());

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

async fn await_shutdown() {
    // TODO: cancellation tokens
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
