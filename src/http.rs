use crate::Backend;
use crate::service::admin::api_key::ApiKeyAdminService;
use crate::service::admin::node::NodeAdminService;
use crate::service::admin::server::ServerAdminService;
use crate::service::admin::user::UserAdminService;
use crate::service::api_key::ApiKeyService;
use crate::service::auth::AuthService;
use crate::service::backup::BackupService;
use crate::service::file::FileService;
use crate::service::internal::InternalService;
use crate::service::minecraft::MinecraftService;
use crate::service::modpack::ModpackService;
use crate::service::profile::ProfileService;
use crate::service::project::ProjectService;
use crate::service::resource::ResourceService;
use crate::service::server::ServerService;
use crate::service::template::TemplateService;
use axum::{Extension, Router};
use axum_server::{Handle, Server};
use core::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use tower_http::cors::Any;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};
use utoipa::OpenApi;
use zelus::framework_router;
use zelus::router::ZelusRouter;

impl Backend {
    pub fn router(&self) -> Router {
        #[derive(OpenApi)]
        #[openapi()]
        struct ApiDoc;

        let (default_router,) = framework_router!(Self self (default,) { ServerService, FileService, BackupService, ServerAdminService, NodeAdminService, UserAdminService, AuthService, ProfileService, ProjectService, TemplateService, InternalService, MinecraftService, ResourceService, ModpackService, ApiKeyService, ApiKeyAdminService });
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
            .layer(Extension(self.clone()))
            .into_openapi()
            .split_for_parts();

        // Mount the entire API (services, internal/daemon routes, and docs) under
        // `/api` so it never collides with the client-side SPA served at the root.
        let mut router = axum::Router::new().nest("/api", api_router);

        #[cfg(debug_assertions)]
        {
            use utoipa_swagger_ui::SwaggerUi;
            router = router.merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", api));
        };
        #[cfg(not(debug_assertions))]
        let _ = api;

        // Serve the built client-only SPA (Vite export) same-origin: `/api/*` is
        // matched above; everything else falls through to `ServeDir`, which serves
        // hashed assets or `index.html` for client-side routes.
        if let Some(dir) = self.config.resolved_frontend_dir() {
            if dir.is_dir() {
                info!("Serving frontend from {}", dir.display());
                let serve_dir =
                    ServeDir::new(&dir).not_found_service(ServeFile::new(dir.join("index.html")));
                router = router.fallback_service(serve_dir);
            } else {
                warn!(
                    "Configured frontend directory {} does not exist; not serving SPA",
                    dir.display()
                );
            }
        }

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

    #[expect(
        clippy::significant_drop_tightening,
        reason = "only runs once on start"
    )]
    pub async fn serve_http(&self) -> Result<(), anyhow::Error> {
        let handle = Handle::new();
        let mut server_task = self.server_task.lock().await;
        for listener in self.config.listeners.clone() {
            let handle = handle.clone();
            let router = self.router();
            server_task.spawn(async move {
                let _ = Server::bind(listener)
                    .handle(handle)
                    .serve(router.into_make_service())
                    .await
                    .inspect_err(|_err| error!("Failed to serve http server!"));
            });
        }
        let mut recv = self.shutdown_channel.subscribe();
        tokio::task::spawn(async move {
            loop {
                match recv.recv().await {
                    Err(RecvError::Lagged(_)) => {}
                    Ok(()) | Err(RecvError::Closed) => {
                        handle.graceful_shutdown(Some(Duration::from_secs(30)));
                        loop {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                            let count = handle.connection_count();
                            if count == 0 {
                                break;
                            }
                            info!("HTTP Connections still alive: {}", count);
                        }
                        break;
                    }
                }
            }
        });
        Ok(())
    }
}
