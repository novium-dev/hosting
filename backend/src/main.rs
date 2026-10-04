#![expect(dead_code, reason = "work in progress")]

mod config;
mod crypto;
pub(crate) mod db;

mod auth;
mod http;
pub(crate) mod integrity;
mod logo;
pub(crate) mod resources;
pub(crate) mod routes;
pub(crate) mod service;
mod shutdown;
pub(crate) mod templates;
mod utils;

use crate::auth::backfill::apply_permission_backfills;
use crate::auth::oauth::AuthService;
use crate::config::BackendConfig;
use crate::db::database::BackendDatabaseHost;
use crate::db::node::BackendNode;
use crate::routes::RouteBackends;
use crate::templates::TemplateInner;
use crate::templates::games::hytale::HytaleTemplate;
use crate::templates::games::minecraft_bedrock::MinecraftBedrockTemplate;
use crate::templates::games::satisfactory::SatisfactoryTemplate;
use crate::templates::games::teamspeak::TeamSpeakTemplate;
use crate::templates::generic::go::GoTemplate;
use crate::templates::generic::java::JavaTemplate;
use crate::templates::generic::javascript::JavascriptTemplate;
use crate::templates::generic::python::PythonTemplate;
use crate::templates::generic::rust::RustTemplate;
use crate::templates::generic::web::WebTemplate;
use core::time::Duration;
use daemon_common::key::rcgen::KeyPair;
use daemon_common::key::{BackendKey, DaemonRootKey};
use daemon_common::node::SetupNodeConfig;
use database_agent_common::types::SetupAgentConfig;
use ed25519_dalek::SigningKey;
use redis::aio::ConnectionManager as CacheConnectionManager;
use sqlx::postgres::PgPoolOptions;
use sqlx::{Connection as _, PgPool};
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use templates::games::minecraft::MinecraftTemplate;
use templates::games::minecraft_proxy::MinecraftProxyTemplate;
use tokio::sync::broadcast::Sender;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinSet;
use tracing::{info, warn};
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;
use uuid::Uuid;

const CACHE_PREFIX: &str = "novium:";

pub const CACHE_KEY_PREFIX: &str = "novium:";

pub struct NodeRegistration {
    time: Instant,
    name: String,
    default_host: String,
    region: crate::db::region::RegionId,
    config: SetupNodeConfig,
}

type NodeRegistrationMap = HashMap<String, NodeRegistration>;

pub struct DatabaseHostRegistration {
    time: Instant,
    display: String,
    region: crate::db::region::RegionId,
    public_host: String,
    config: SetupAgentConfig,
}

type DatabaseHostRegistrationMap = HashMap<String, DatabaseHostRegistration>;

#[derive(Clone)]
pub(crate) struct Backend {
    pub(crate) database: Arc<PgPool>,
    pub(crate) cache: CacheConnectionManager,
    pub(crate) auth: Arc<AuthService>,

    pub(crate) config: Arc<BackendConfig>,
    pub(crate) nodes: Arc<RwLock<HashMap<Uuid, Arc<BackendNode>>>>,
    pub(crate) database_hosts: Arc<RwLock<HashMap<Uuid, Arc<BackendDatabaseHost>>>>,

    pub(crate) http_client: reqwest::Client,
    pub(crate) curseforge_api_key: Option<Arc<str>>,

    pub(crate) route_backends: Arc<RouteBackends>,

    pub(crate) node_registrations: Arc<RwLock<NodeRegistrationMap>>,
    pub(crate) database_host_registrations: Arc<RwLock<DatabaseHostRegistrationMap>>,

    pub(crate) templates: Arc<RwLock<HashMap<String, Arc<dyn TemplateInner + Send + Sync>>>>,

    pub(crate) modpack_jobs:
        Arc<RwLock<HashMap<crate::db::server::ServerId, crate::service::modpack::ModpackJob>>>,

    pub(crate) integrity: Arc<RwLock<crate::integrity::IntegrityRun>>,

    pub(crate) server_task_cancellable: Arc<Mutex<JoinSet<()>>>,
    pub(crate) server_task: Arc<Mutex<JoinSet<()>>>,
    pub(crate) shutdown_task: Arc<Mutex<JoinSet<()>>>,
    pub(crate) shutdown_channel: Arc<Sender<()>>,

    pub(crate) root_key: Arc<DaemonRootKey>,
    pub(crate) root_privkey: Arc<KeyPair>,
    pub(crate) user_key: SigningKey,
    pub(crate) key: Arc<BackendKey>,
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
        .expect("Unable to install default crypto provider");

    #[cfg(not(debug_assertions))]
    let guard = {
        reg.with(sentry::integrations::tracing::layer()).init();
        let sentry = sentry::init((
            "https://b43378f14d709f18980434afbb4f667d@sentry.novium.world/4",
            {
                let mut options = sentry::ClientOptions::default();
                options.release = sentry::release_name!();
                options
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

async fn load_templates(backend: &Backend) {
    let mut templates = backend.templates.write().await;
    let skip_cache_update = backend.config.skip_template_cache_update;

    if skip_cache_update {
        info!("Template cache updates are disabled");
    }

    let minecraft = MinecraftTemplate;
    minecraft
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize minecraft template");
    templates.insert(minecraft.id().to_owned(), Arc::new(minecraft));

    let minecraft_proxy = MinecraftProxyTemplate;
    minecraft_proxy
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize minecraft proxy template");
    templates.insert(minecraft_proxy.id().to_owned(), Arc::new(minecraft_proxy));

    let minecraft_bedrock = MinecraftBedrockTemplate;
    minecraft_bedrock
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize minecraft bedrock template");
    templates.insert(
        minecraft_bedrock.id().to_owned(),
        Arc::new(minecraft_bedrock),
    );

    let go = GoTemplate;
    go.init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize go template");
    templates.insert(go.id().to_owned(), Arc::new(go));

    let java = JavaTemplate;
    java.init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize java template");
    templates.insert(java.id().to_owned(), Arc::new(java));

    let javascript = JavascriptTemplate;
    javascript
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize javascript template");
    templates.insert(javascript.id().to_owned(), Arc::new(javascript));

    let python = PythonTemplate;
    python
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize python template");
    templates.insert(python.id().to_owned(), Arc::new(python));

    let rust = RustTemplate;
    rust.init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize rust template");
    templates.insert(rust.id().to_owned(), Arc::new(rust));

    let web = WebTemplate;
    web.init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize web template");
    templates.insert(web.id().to_owned(), Arc::new(web));

    let satisfactory = SatisfactoryTemplate;
    satisfactory
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize satisfactory template");
    templates.insert(satisfactory.id().to_owned(), Arc::new(satisfactory));

    let hytale = HytaleTemplate;
    hytale
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize hytale template");
    templates.insert(hytale.id().to_owned(), Arc::new(hytale));

    let teamspeak = TeamSpeakTemplate;
    teamspeak
        .init(backend.cache.clone(), skip_cache_update)
        .await
        .expect("Unable to initialize teamspeak template");
    templates.insert(teamspeak.id().to_owned(), Arc::new(teamspeak));
}

#[tokio::main]
async fn main0() {
    info!("Starting Backend on version {}", env!("GIT_HASH"));

    let data_dir =
        env::var_os("BACKEND_DATA_DIR").map_or_else(|| PathBuf::from("."), PathBuf::from);

    info!("Using data directory {}", data_dir.display());

    let (root_key, root_privkey, user_key, backend_key) =
        crypto::check_and_generate_keys(&data_dir).await;

    let config = BackendConfig::from_env().expect("Unable to load configuration");

    let database = Arc::new(loop {
        match PgPoolOptions::new()
            .max_connections(5)
            .connect(&config.database_url)
            .await
        {
            Ok(conn) => break conn,
            Err(err) => {
                warn!("Postgres connection attempt failed: {err:?}");
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    });

    sqlx::migrate!("./migrations")
        .run(&*database)
        .await
        .expect("Unable to run migrations");

    apply_permission_backfills(&database)
        .await
        .expect("Unable to apply the permission backfills");

    let cache = loop {
        let client = redis::Client::open(&*config.cache_url).expect("Invalid cache url");
        match CacheConnectionManager::new(client).await {
            Ok(conn) => {
                break conn;
            }
            Err(err) => {
                warn!("Cache connection attempt failed: {err:?}");
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    };

    let curseforge_api_key = config.resources.curseforge_api_key.clone();
    if curseforge_api_key.is_none() {
        info!("No CurseForge API key configured; the CurseForge provider stays disabled");
    }

    let http_client = reqwest::Client::builder()
        .user_agent(concat!("novium-backend/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Unable to build HTTP client");

    let route_backends = RouteBackends::new(&config.routes, &http_client);

    let backend = Backend {
        database,
        cache,
        auth: Arc::new(AuthService::new(&config.auth).expect("Unable to build AuthService")),

        config: Arc::new(config),
        nodes: Arc::default(),
        database_hosts: Arc::default(),

        http_client,
        curseforge_api_key: curseforge_api_key.map(Arc::from),

        route_backends: Arc::new(route_backends),

        node_registrations: Arc::default(),
        database_host_registrations: Arc::default(),

        templates: Arc::default(),
        modpack_jobs: Arc::default(),
        integrity: Arc::default(),

        shutdown_channel: Arc::new(Sender::new(1)),
        server_task: Arc::default(),
        server_task_cancellable: Arc::default(),
        shutdown_task: Arc::default(),

        root_key,
        root_privkey: Arc::new(root_privkey),
        key: Arc::new(backend_key),
        user_key,
    };

    let backend2 = backend.clone();
    backend
        .database
        .acquire()
        .await
        .expect("Unable to acquire database connection")
        .transaction(|tx| Box::pin(async move { backend2.sync_nodes(tx).await }))
        .await
        .expect("Unable to sync nodes cache");

    let backend3 = backend.clone();
    backend
        .database
        .acquire()
        .await
        .expect("Unable to acquire database connection")
        .transaction(|tx| Box::pin(async move { backend3.sync_database_hosts(tx).await }))
        .await
        .expect("Unable to sync database hosts cache");

    info!("Initializing Templates...");

    load_templates(&backend).await;

    backend.spawn_session_cleanup();

    info!("Starting Webserver...");

    backend
        .serve_http()
        .await
        .expect("Unable to serve http server");

    backend.hook_signals();

    info!("Ready");

    backend.await_shutdown().await;
}

#[cfg(all(not(debug_assertions), feature = "auth_dev"))]
compile_error!("Dev auth cannot be enabled in production builds!");
