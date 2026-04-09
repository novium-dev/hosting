use crate::Backend;
use crate::service::admin::node::NodeAdminService;
use crate::service::admin::server::ServerAdminService;
use crate::service::backup::BackupService;
use crate::service::file::FileService;
use crate::service::internal::InternalService;
use crate::service::server::ServerService;
use crate::service::template::TemplateService;
use axum::{Extension, Router};
use axum_server::{Handle, Server};
use core::time::Duration;
use http::HeaderValue;
use tokio::sync::broadcast::error::RecvError;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use utoipa::OpenApi;
use zelus::framework_router;
use zelus::router::ZelusRouter;

impl Backend {
    #[expect(clippy::needless_for_each, reason = "caused by OpenApi derive macro")]
    pub fn router(&self) -> Router {
        #[derive(OpenApi)]
        #[openapi()]
        struct ApiDoc;

        let (router,) = framework_router!(Self self (default,) { ServerService, FileService, BackupService, ServerAdminService, NodeAdminService, TemplateService, InternalService });

        let cors = tower_http::cors::CorsLayer::new()
            .allow_origin(tower_http::cors::AllowOrigin::list(
                self.config.trusted_urls.iter().map(|url| {
                    HeaderValue::from_str(url.as_str()).expect("invalid trusted URL header value")
                }),
            ))
            .allow_methods([axum::http::Method::GET])
            .allow_headers(tower_http::cors::AllowHeaders::any());

        let (mut router, api) = ZelusRouter::with_openapi(ApiDoc::openapi())
            .merge(router)
            .layer(cors)
            .layer(Extension(self.clone()))
            .into_openapi()
            .split_for_parts();

        #[cfg(debug_assertions)]
        {
            use utoipa_swagger_ui::SwaggerUi;
            router = router.merge(SwaggerUi::new("/docs").url("/docs/openapi.json", api));
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
