use zelus::error::define_error;
use zelus::{define_path_variable, define_query_variable};

pub(crate) mod admin;
pub(crate) mod file;
pub(crate) mod internal;
pub(crate) mod server;
pub(crate) mod template;

define_error!(auth {
    invalid("Invalid authentication credentials" UNAUTHORIZED),
    unreachable("JWKS is unreachable" INTERNAL_SERVER_ERROR),
    permission_denied("You don't have the necessary permissions to perform this operation" FORBIDDEN),
});

define_error!(server {
    not_found("Server not found" NOT_FOUND),
    storage_not_found("The specified storage was not found" BAD_REQUEST),
    unavailable("Server is currently in use" SERVICE_UNAVAILABLE)
});

define_error!(file {
    storage_unavailable("Storage is currently in use" SERVICE_UNAVAILABLE),
    not_found("The specified file was not found" NOT_FOUND),
    sandbox_violated("The specified file violates the sandbox" BAD_REQUEST),
    not_directory("The specified file is not a directory" BAD_REQUEST),
    already_exists("A file with the specified name already exists" BAD_REQUEST),
    is_directory("The specified file is a directory" BAD_REQUEST),
    quota_exceeded("The file exceeds the server's storage quota" BAD_REQUEST),
    compression_unsupported("The specified compression method is unsupported" BAD_REQUEST),
});

define_error!(port {
    invalid("The specified port range is invalid" BAD_REQUEST),
    not_allocated("The specified port range is not allocated to the server" BAD_REQUEST),
    collision("The specified port range collides with another server's ports" BAD_REQUEST),
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

define_query_variable!(
    owner "The server owner"
);

define_query_variable!(
    path "The file path"
);

define_path_variable!(
    port_id "The port ID"
);

define_query_variable!(
    from "The name to rename from"
);

define_query_variable!(
    to "The name to rename to"
);

define_query_variable!(
    recursive "Whether the operation should be applied recursively"
);

define_query_variable!(
    compression "The compression method to use"
);
