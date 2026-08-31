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

pub trait DatabaseAgentServices:
    InstanceService
    + DatabaseService
    + UserService
    + SystemService
    + SetupService
    + IntegrityService
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
