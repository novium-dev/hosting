mod crypto;
pub(crate) mod error;
pub(crate) mod db;
pub(crate) mod templates;

use std::env;
use std::sync::Arc;
use std::time::Duration;
use daemon_common::key::{BackendKey, DaemonRootKey};
use daemon_common::key::rcgen::KeyPair;
use ed25519_dalek::SigningKey;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use tracing::{debug, info};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

const DATABASE_URL: &str = "mysql://root@localhost/backend";
pub const CACHE_KEY_PREFIX: &str = "novium:";

#[derive(Clone)]
pub(crate) struct Backend {
    pub(crate) database: Arc<MySqlPool>,

    pub(crate) root_key: Arc<DaemonRootKey>,
    pub(crate) root_privkey: Arc<KeyPair>,
    pub(crate) user_key: SigningKey,
    pub(crate) backend_key: Arc<BackendKey>,
}

pub fn main() {
    let reg = tracing_subscriber::registry()
        .with(tracing_subscriber::filter::LevelFilter::from_level(
            if cfg!(debug_assertions) || env::var("DEBUG").unwrap_or_default().eq("1") {
                tracing::Level::DEBUG
            } else {
                tracing::Level::INFO
            },
        ))
        .with(tracing_subscriber::fmt::layer());

    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .unwrap();

    #[cfg(not(debug_assertions))]
    let guard = {
        reg.with(sentry::integrations::tracing::layer()).init();
        let sentry = sentry::init((
            "https://79a1f560730aef34fdc4e4a3f3d9ce92@o4507044844404736.ingest.us.sentry.io/4508313795297280",
            sentry::ClientOptions {
                release: sentry::release_name!(),
                ..Default::default()
            },
        ));
        if sentry.is_enabled() {
            info!("Enabled Sentry integration");
        }
        sentry
    };
    #[cfg(debug_assertions)]
    reg.init();

    main0();

    #[cfg(not(debug_assertions))]
    drop(guard);
}

#[tokio::main]
async fn main0() {
    info!("Starting Backend on version {}", env!("GIT_HASH"));

    let (root_key, root_privkey, user_key, backend_key) = crypto::check_and_generate_keys().await;

    let backend = Backend {
        database: Arc::new(loop {
            match MySqlPoolOptions::new()
                .max_connections(5)
                .connect(&env::var("DATABASE_URL").unwrap_or(DATABASE_URL.to_string()))
                .await
            {
                Ok(conn) => {
                    break conn
                },
                Err(err) => {
                    debug!("MySQL connection attempt failed: {:?}", err);
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }),
        root_key: Arc::new(root_key),
        root_privkey: Arc::new(root_privkey),
        backend_key: Arc::new(backend_key),
        user_key,
    };

    sqlx::migrate!("./migrations")
        .run(backend.database.as_ref())
        .await
        .expect("Unable to run migrations");

}
