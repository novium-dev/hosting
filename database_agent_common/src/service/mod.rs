use crate::service::database::{DatabaseService, DatabaseServiceClientImpl, DatabaseServiceURL};
use crate::service::instance::{InstanceService, InstanceServiceClientImpl, InstanceServiceURL};
use crate::service::integrity::{
    IntegrityService, IntegrityServiceClientImpl, IntegrityServiceURL,
};
use crate::service::setup::{SetupService, SetupServiceClientImpl, SetupServiceURL};
use crate::service::system::{SystemService, SystemServiceClientImpl, SystemServiceURL};
use crate::service::user::{UserService, UserServiceClientImpl, UserServiceURL};

pub(crate) use zelus::error::{define_error, error};
pub(crate) use zelus::{define_path_variable, define_query_variable};

pub use zelus::framework_router;
pub use zelus::responses::FileResponse;
pub use zelus::sdk::ZelusClientImpl;
pub use zelus::types::DataStream;

pub mod database;
pub mod instance;
pub mod integrity;
pub mod setup;
pub mod system;
pub mod user;

define_error!(auth {
    invalid("Authentication is invalid" UNAUTHORIZED),
});

define_error!(instance {
    not_found("The instance does not exist" NOT_FOUND),
    offline("The instance must be online for this operation" CONFLICT),
    disk_full("The instance is over its disk limit" CONFLICT),
    unsupported("The operation is not supported for this database type" BAD_REQUEST),
    failure("The instance operation failed" INTERNAL_SERVER_ERROR),
});

define_error!(database {
    not_found("The database does not exist" NOT_FOUND),
    name_invalid("The database name must be 1-63 ascii alphanumeric characters" BAD_REQUEST),
    name_taken("A database with this name already exists on the instance" BAD_REQUEST),
    failure("The database operation failed" INTERNAL_SERVER_ERROR),
});

define_error!(user {
    not_found("The user does not exist" NOT_FOUND),
    name_invalid("The username must be 2-23 ascii alphanumeric characters" BAD_REQUEST),
    failure("The user operation failed" INTERNAL_SERVER_ERROR),
});

define_error!(store {
    failure("The agent state store failed" INTERNAL_SERVER_ERROR),
});

define_error!(docker {
    failure("The container engine returned an error" INTERNAL_SERVER_ERROR),
});

define_path_variable!(instance_id "The instance id");
define_path_variable!(database_id "The database id");
define_path_variable!(user_id "The user id");

define_query_variable!(database "The database name the operation applies to");
define_query_variable!(lines "The number of log lines to return");
define_query_variable!(wipe "Whether the target is wiped before the import");

error!(BlankError, auth::invalid);

/// Builds the `OpenAPI` document describing every route the agent serves.
///
/// Both the agent and the backend can call this: the routes come from the
/// service definitions in this crate, and the instance only backs the handler
/// closures, which the document does not describe.
#[must_use]
pub fn api_document<T>(instance: &T) -> utoipa::openapi::OpenApi
where
    T: DatabaseAgentServices + Clone + Send + Sync + Sized + 'static,
{
    use utoipa::OpenApi as _;

    #[derive(utoipa::OpenApi)]
    #[openapi()]
    struct ApiDoc;

    let (with_auth, without_auth) = framework_router!(T instance (with_auth,without_auth,) {
        InstanceService, DatabaseService, UserService, SystemService, SetupService,
        IntegrityService
    });

    let (_router, api) = utoipa_axum::router::OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(with_auth.into_openapi())
        .merge(without_auth.into_openapi())
        .split_for_parts();

    api
}

/// Fingerprint of the agent's `OpenAPI` document, so the backend can tell a
/// host serving a different API surface from one that merely sits on a
/// different commit.
#[must_use]
pub fn api_hash<T>(instance: &T) -> String
where
    T: DatabaseAgentServices + Clone + Send + Sync + Sized + 'static,
{
    use core::fmt::Write as _;
    use sha2::Digest as _;

    let document = serde_json::to_string(&api_document(instance)).unwrap_or_default();

    let mut out = String::new();
    for byte in sha2::Sha256::digest(document.as_bytes()) {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub trait DatabaseAgentServices:
    InstanceService + DatabaseService + UserService + SystemService + SetupService + IntegrityService
{
}

pub trait DatabaseAgentServicesClientImpl:
    InstanceServiceClientImpl
    + DatabaseServiceClientImpl
    + UserServiceClientImpl
    + SystemServiceClientImpl
    + SetupServiceClientImpl
    + IntegrityServiceClientImpl
{
}

pub trait DatabaseAgentServicesURL:
    DatabaseAgentServices
    + InstanceServiceURL
    + DatabaseServiceURL
    + UserServiceURL
    + SystemServiceURL
    + SetupServiceURL
    + IntegrityServiceURL
{
}
