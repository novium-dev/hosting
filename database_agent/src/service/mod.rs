mod database;
mod instance;
mod system;
mod user;

use crate::state::Agent;
use axum::Router;
use axum::extract::Request;
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::{IntoResponse as _, Response};
use axum_server::{Handle, Server};
use core::net::SocketAddr;
use core::time::Duration;
use database_agent_common::service::database::DatabaseService;
use database_agent_common::service::error_database_failure::FromDatabaseFailure;
use database_agent_common::service::error_instance_failure::FromInstanceFailure;
use database_agent_common::service::error_store_failure::FromStoreFailure;
use database_agent_common::service::error_user_failure::FromUserFailure;
use database_agent_common::service::instance::InstanceService;
use database_agent_common::service::system::SystemService;
use database_agent_common::service::user::UserService;
use database_agent_common::service::{BlankError, framework_router};
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

pub trait OrInstanceFailure<T> {
    fn or_instance_failure<E: FromInstanceFailure>(self, context: &str) -> Result<T, E>;
}

pub trait OrDatabaseFailure<T> {
    fn or_database_failure<E: FromDatabaseFailure>(self, context: &str) -> Result<T, E>;
}

pub trait OrUserFailure<T> {
    fn or_user_failure<E: FromUserFailure>(self, context: &str) -> Result<T, E>;
}

pub trait OrStoreFailure<T> {
    fn or_store_failure<E: FromStoreFailure>(self, context: &str) -> Result<T, E>;
}

impl<T> OrInstanceFailure<T> for anyhow::Result<T> {
    fn or_instance_failure<E: FromInstanceFailure>(self, context: &str) -> Result<T, E> {
        self.map_err(|err| {
            error!("{context}: {err:?}");
            E::from()
        })
    }
}

impl<T> OrDatabaseFailure<T> for anyhow::Result<T> {
    fn or_database_failure<E: FromDatabaseFailure>(self, context: &str) -> Result<T, E> {
        self.map_err(|err| {
            error!("{context}: {err:?}");
            E::from()
        })
    }
}

impl<T> OrUserFailure<T> for anyhow::Result<T> {
    fn or_user_failure<E: FromUserFailure>(self, context: &str) -> Result<T, E> {
        self.map_err(|err| {
            error!("{context}: {err:?}");
            E::from()
        })
    }
}

impl<T> OrStoreFailure<T> for anyhow::Result<T> {
    fn or_store_failure<E: FromStoreFailure>(self, context: &str) -> Result<T, E> {
        self.map_err(|err| {
            error!("{context}: {err:?}");
            E::from()
        })
    }
}

impl Agent {
    async fn authenticate(&self, request: Request, next: Next) -> Response {
        let presented = request
            .headers()
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or_default();

        if !crate::utils::constant_time_eq(presented.as_bytes(), self.config.api.token.as_bytes()) {
            return BlankError::AuthInvalid.into_response();
        }

        next.run(request).await
    }

    pub fn router(&self) -> Router {
        #[derive(OpenApi)]
        #[openapi()]
        struct ApiDoc;

        let (authenticated, public) = framework_router!(Self self (with_auth,without_auth,) {
            InstanceService, DatabaseService, UserService, SystemService
        });

        let agent = self.clone();
        let authenticated = authenticated
            .into_openapi()
            .layer(axum::middleware::from_fn(move |request, next| {
                let agent = agent.clone();
                async move { agent.authenticate(request, next).await }
            }));

        let (mut router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
            .merge(authenticated)
            .merge(public.into_openapi())
            .split_for_parts();

        #[cfg(debug_assertions)]
        {
            use utoipa_swagger_ui::SwaggerUi;
            router = router.merge(SwaggerUi::new("/docs").url("/docs/openapi.json", api));
        };
        #[cfg(not(debug_assertions))]
        let _ = api;

        router.layer(TraceLayer::new_for_http())
    }

    pub fn serve_http(&self, handle: Handle<SocketAddr>) {
        let bind = self.config.api.bind;
        let router = self.router();

        info!("api listening on {bind}");

        tokio::spawn(async move {
            let _ = Server::bind(bind)
                .handle(handle)
                .serve(router.into_make_service())
                .await
                .inspect_err(|err| error!("failed to serve the http server: {err}"));
        });
    }
}

pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(30);
