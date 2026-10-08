use crate::Backend;
use crate::service::admin::api_key::ApiKeyAdminService;
use crate::service::admin::database::DatabaseAdminService;
use crate::service::admin::deploy::DeployAdminService;
use crate::service::admin::group::GroupAdminService;
use crate::service::admin::integrity::IntegrityAdminService;
use crate::service::admin::node::NodeAdminService;
use crate::service::admin::route::RouteAdminService;
use crate::service::admin::server::ServerAdminService;
use crate::service::admin::template::TemplateAdminService;
use crate::service::admin::user::UserAdminService;
use crate::service::api_key::ApiKeyService;
use crate::service::auth::AuthService;
use crate::service::backup::BackupService;
use crate::service::database::DatabaseService;
use crate::service::file::FileService;
use crate::service::instance::InstanceService;
use crate::service::internal::InternalService;
use crate::service::minecraft::MinecraftService;
use crate::service::modpack::ModpackService;
use crate::service::profile::ProfileService;
use crate::service::project::ProjectService;
use crate::service::resource::ResourceService;
use crate::service::route::RouteService;
use crate::service::schedule::ScheduleService;
use crate::service::server::ServerService;
use crate::service::template::TemplateService;
use axum::http::StatusCode;
use axum::{Extension, Router};
use axum_server::{Handle, Server};
use core::net::SocketAddr;
use core::time::Duration;
use sqlx::query_scalar;
use tokio::task::JoinSet;
use tower_http::cors::Any;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use utoipa::OpenApi;
use zelus::framework_router;
use zelus::router::ZelusRouter;

impl Backend {
    pub fn router(&self) -> Router {
        #[derive(OpenApi)]
        #[openapi()]
        struct ApiDoc;

        let (default_router,) = framework_router!(Self self (default,) { ServerService, FileService, BackupService, ServerAdminService, NodeAdminService, UserAdminService, AuthService, ProfileService, ProjectService, TemplateService, InternalService, MinecraftService, ResourceService, ModpackService, ApiKeyService, ApiKeyAdminService, TemplateAdminService, RouteService, RouteAdminService, ScheduleService, DatabaseService, DatabaseAdminService, IntegrityAdminService, InstanceService, GroupAdminService, DeployAdminService });
        let (dev_auth_router,) = framework_router!(Self self (dev_auth,) { AuthService });

        let router = if cfg!(feature = "auth_dev") {
            default_router.merge(dev_auth_router)
        } else {
            default_router
        };

        let cors = tower_http::cors::CorsLayer::new()
            .allow_origin(Any)
            .allow_headers(Any)
            .allow_methods(Any)
            .max_age(Duration::from_hours(1));

        let (api_router, api) = ZelusRouter::with_openapi(ApiDoc::openapi())
            .merge(router)
            .layer(cors)
            .layer(axum::middleware::from_fn(crate::auth::csrf::verify_origin))
            .layer(Extension(self.clone()))
            .into_openapi()
            .split_for_parts();

        let backend = self.clone();
        let api_router = api_router.route(
            "/health",
            axum::routing::get(move || {
                let backend = backend.clone();
                async move { backend.health().await }
            }),
        );

        let mut router = axum::Router::new().nest("/api", api_router);

        #[cfg(debug_assertions)]
        {
            use utoipa_swagger_ui::SwaggerUi;
            router = router.merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", api));
        };
        #[cfg(not(debug_assertions))]
        let _ = api;

        router = router.layer(TraceLayer::new_for_http());

        #[cfg(not(debug_assertions))]
        {
            use sentry::integrations::tower::{NewSentryLayer, SentryHttpLayer};
            router = router
                .layer(NewSentryLayer::<axum::extract::Request>::new_from_top())
                .layer(SentryHttpLayer::new().enable_transaction());
        };
        router
    }

    async fn health(&self) -> StatusCode {
        match query_scalar!("SELECT 1").fetch_one(&*self.database).await {
            Ok(_) => StatusCode::OK,
            Err(err) => {
                error!("Health check failed: {err:?}");
                StatusCode::SERVICE_UNAVAILABLE
            }
        }
    }

    pub async fn serve_http(&self) -> Result<(), anyhow::Error> {
        let handle = Handle::new();
        let mut servers = JoinSet::new();
        for listener in self.config.listeners.clone() {
            let handle = handle.clone();
            let router = self.router();
            servers.spawn(async move {
                let _ = Server::bind(listener)
                    .handle(handle)
                    .serve(router.into_make_service_with_connect_info::<SocketAddr>())
                    .await
                    .inspect_err(|_err| error!("Failed to serve http server!"));
            });
        }

        let shutdown = self.shutdown.clone();
        tokio::spawn(async move {
            shutdown.cancelled().await;
            handle.graceful_shutdown(Some(Duration::from_secs(30)));
        });

        info!("Ready");
        servers.join_all().await;
        Ok(())
    }
}
