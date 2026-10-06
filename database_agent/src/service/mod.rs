mod database;
mod instance;
mod integrity;
mod setup;
mod system;
mod user;

use crate::state::Agent;
use axum::Extension;
use axum::Router;
use axum::extract::Request;
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
use database_agent_common::service::integrity::IntegrityService;
use database_agent_common::service::setup::SetupService;
use database_agent_common::service::system::SystemService;
use database_agent_common::service::user::UserService;
use database_agent_common::service::{BlankError, DatabaseAgentServices, framework_router};
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use zelus_keys::server::{CertResolver, TlsAcceptor, TlsData, server_config};

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

pub async fn middleware(
    Extension(TlsData { peer_certificates }): Extension<TlsData>,
    request: Request,
    next: Next,
) -> Response {
    if peer_certificates.is_none() {
        return BlankError::AuthInvalid.into_response();
    }
    next.run(request).await
}

impl DatabaseAgentServices for Agent {}

impl Agent {
    pub fn router(&self) -> Router {
        #[derive(OpenApi)]
        #[openapi()]
        struct ApiDoc;

        let (authenticated, public) = framework_router!(Self self (with_auth,without_auth,) {
            InstanceService, DatabaseService, UserService, SystemService, SetupService,
            IntegrityService
        });

        let authenticated = authenticated
            .into_openapi()
            .layer(axum::middleware::from_fn(middleware));

        let (router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
            .merge(authenticated)
            .merge(public.into_openapi())
            .split_for_parts();

        #[cfg(debug_assertions)]
        let router = {
            use utoipa_swagger_ui::SwaggerUi;
            router.merge(SwaggerUi::new("/docs").url("/docs/openapi.json", api))
        };

        #[cfg(not(debug_assertions))]
        let router = router;

        #[cfg(not(debug_assertions))]
        let _ = api;

        router.layer(TraceLayer::new_for_http())
    }

    pub fn serve_http(&self, handle: Handle<SocketAddr>) -> Result<(), anyhow::Error> {
        let bind = self.config.api.bind;
        let router = self.router();
        let rustls = server_config(&self.root, CertResolver::new(&self.key))?;

        info!("api listening on {bind}");

        tokio::spawn(async move {
            let _ = Server::bind(bind)
                .acceptor(TlsAcceptor::new(rustls))
                .handle(handle)
                .serve(router.into_make_service())
                .await
                .inspect_err(|err| error!("failed to serve the http server: {err}"));
        });

        Ok(())
    }
}

pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(30);
