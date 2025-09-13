use crate::Backend;
use crate::service::server::ServerService;
use axum::Router;
use axum_server::{Handle, Server};
use core::time::Duration;
use daemon_framework::framework_router;
use daemon_framework::router::FrameworkRouter;
use tokio::sync::broadcast::error::RecvError;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use utoipa::OpenApi;
use utoipa::openapi::Required;
use utoipa::openapi::path::{ParameterBuilder, ParameterIn};

impl Backend {
    #[expect(clippy::needless_for_each, reason = "caused by OpenApi derive macro")]
    pub fn router(&self) -> Router {
        #[derive(OpenApi)]
        #[openapi()]
        struct ApiDoc;

        let (router,) = framework_router!(Self self (default,) { ServerService });

        let (mut router, api) = FrameworkRouter::with_openapi(ApiDoc::openapi())
            .merge(router)
            .document_middleware(|_method, responses, mut operations, schemas| {
                operations = operations.parameter(
                    ParameterBuilder::new()
                        .name("Authorization")
                        .parameter_in(ParameterIn::Header)
                        .description(Some("The session token or api key"))
                        .required(Required::False),
                );
                (responses, operations, schemas)
            })
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
