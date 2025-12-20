use zelus::define_path_variable;
use zelus::error::define_error;

pub(crate) mod admin;
pub(crate) mod auth;
pub(crate) mod server;
pub(crate) mod template;

define_error!(auth {
    invalid("Invalid authentication credentials" UNAUTHORIZED),
    misconfigured("Authentication system is misconfigured" INTERNAL_SERVER_ERROR),
    permission_denied("You don't have the necessary permissions to perform this operation" FORBIDDEN),
});

define_error!(server {
    not_found("Server not found" NOT_FOUND),
    storage_not_found("The specified storage was not found" BAD_REQUEST),
    unavailable("Server is currently in use" SERVICE_UNAVAILABLE)
});

define_error!(node {
    not_found("The specified node was not found" BAD_REQUEST),
    failure("Node operation failed" BAD_GATEWAY),
});

define_error!(db {
    failure("Database operation failed" INTERNAL_SERVER_ERROR),
});

define_error!(cache {
    failure("Cache operation failed" INTERNAL_SERVER_ERROR),
    unreachable("Cache is unreachable" SERVICE_UNAVAILABLE),
});

define_error!(os {
    failure("OS operation failed" INTERNAL_SERVER_ERROR), // For example, "random" function returns an error.
});

define_path_variable!(
    server_id "The server ID"
);
