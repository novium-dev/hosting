use zelus::define_path_variable;
use zelus::error::define_error;

pub(crate) mod admin;
pub(crate) mod server;
pub(crate) mod template;

define_error!(auth {
    invalid("Invalid authentication credentials" UNAUTHORIZED),
    permission_denied("You don't have the necessary permissions to perform this operation" FORBIDDEN),
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
});

define_path_variable!(
    server_id "The server ID"
);
