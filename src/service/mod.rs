use daemon_framework::{define_error, define_path_variable};

mod admin;
pub(crate) mod server;
pub(crate) mod template;

define_error!(auth {
    invalid("Invalid authentication credentials" UNAUTHORIZED),
});

define_error!(node {
    not_found("The specified node was not found" BAD_REQUEST),
});

define_error!(db {
    failure("Database operation failed" INTERNAL_SERVER_ERROR),
});

define_path_variable!(
    server_id "The server ID"
);
