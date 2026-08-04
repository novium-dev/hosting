pub mod data;

use crate::config::AgentConfig;
use anyhow::Context as _;
use core::str::FromStr as _;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

pub struct Store {
    read: SqlitePool,
    write: SqlitePool,
}

impl Store {
    pub async fn open(config: &AgentConfig) -> anyhow::Result<Self> {
        if let Some(parent) = config.data_dir.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        tokio::fs::create_dir_all(&config.data_dir)
            .await
            .with_context(|| format!("failed to create {}", config.data_dir.display()))?;

        let options = SqliteConnectOptions::from_str(&config.store.url)
            .context("invalid store url")?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal);

        let write = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .context("failed to open the store for writing")?;

        sqlx::migrate!("./migrations")
            .run(&write)
            .await
            .context("failed to migrate the store")?;

        let read = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options.read_only(true))
            .await
            .context("failed to open the store for reading")?;

        Ok(Self { read, write })
    }

    pub const fn read(&self) -> &SqlitePool {
        &self.read
    }

    pub const fn write(&self) -> &SqlitePool {
        &self.write
    }
}
