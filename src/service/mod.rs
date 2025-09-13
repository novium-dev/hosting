use daemon_framework::{define_error, define_path_variable};

pub(crate) mod server;
pub(crate) mod template;

define_error!(auth {
    invalid("Invalid authentication credentials" UNAUTHORIZED),
});

define_error!(db {
    failure("Database operation failed" INTERNAL_SERVER_ERROR),
});

define_error!(server {
    not_found("Server not found" NOT_FOUND),
});

define_path_variable!(
    server_id "The server ID"
);
