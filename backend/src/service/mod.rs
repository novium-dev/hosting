use zelus::error::define_error;
use zelus::{define_path_variable, define_query_variable};

pub(crate) mod admin;
pub(crate) mod api_key;
pub(crate) mod auth;
pub(crate) mod backup;
pub(crate) mod database;
pub(crate) mod file;
pub(crate) mod internal;
pub(crate) mod minecraft;
pub(crate) mod modpack;
pub(crate) mod profile;
pub(crate) mod project;
pub(crate) mod resource;
pub(crate) mod route;
pub(crate) mod server;
pub(crate) mod template;

define_error!(auth {
    invalid("Invalid authentication credentials" UNAUTHORIZED),
    failure("Authentication is failure" INTERNAL_SERVER_ERROR),
    unreachable("Authentication storage is unreachable" INTERNAL_SERVER_ERROR),
    permission_denied("You don't have the necessary permissions to perform this operation" FORBIDDEN),
});

define_error!(server {
    not_found("Server not found" NOT_FOUND),
    storage_not_found("The specified storage was not found" BAD_REQUEST),
    unavailable("Server is currently in use" SERVICE_UNAVAILABLE),
    suspension_reason_required("Suspending a server requires a reason" BAD_REQUEST),
    not_suspended("The server is not suspended" BAD_REQUEST),
    config_invalid("The server config file is invalid" BAD_REQUEST)
});

define_error!(project {
    not_found("Project not found" NOT_FOUND),
    not_empty("Project still has servers or databases" BAD_REQUEST),
    slug_invalid("The slug must be 1-64 characters of lowercase letters, numbers or hyphens, and must not be reserved" BAD_REQUEST),
});

define_error!(user {
    not_found("User not found" NOT_FOUND),
    owns_project("User still owns projects" BAD_REQUEST),
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
    unsupported_type("The specified file type is unsupported" BAD_REQUEST),
    content_invalid("The specified content is invalid" BAD_REQUEST),
});

define_error!(resource {
    invalid_payload("The resource payload is invalid" BAD_REQUEST),
    provider_unavailable("The resource provider is currently unavailable" SERVICE_UNAVAILABLE),
    provider_disabled("The resource provider is not configured on this instance" BAD_REQUEST),
    missing("The specified resource is missing" NOT_FOUND),
    provider_error("The resource provider returned an error" BAD_GATEWAY),
    wrong_template("The resource is not compatible with the server template" BAD_REQUEST),
    download_unavailable("The resource cannot be downloaded automatically" BAD_REQUEST),
    not_installed("The resource is not installed on this server" NOT_FOUND),
});

define_error!(backup {
    storage_unavailable("Backup storage is currently in use" SERVICE_UNAVAILABLE),
    not_found("The specified backup was not found" NOT_FOUND),
    storage_not_found("The specified backup storage was not found" BAD_REQUEST),
    storage_incompatible("The selected backup storage is incompatible" BAD_REQUEST),
    no_suitable_storage_found("No suitable backup storage was found" BAD_REQUEST),
    compression_not_allowed("The selected backup compression is not allowed" BAD_REQUEST),
    limit_exceeded("The server backup limit has been reached" BAD_REQUEST),
    quota_exceeded("Restoring this backup would exceed storage quota" BAD_REQUEST),
});

define_error!(port {
    invalid("The specified port range is invalid" BAD_REQUEST),
    not_allocated("The specified port range is not allocated to the server" BAD_REQUEST),
    collision("The specified port range collides with another server's ports" BAD_REQUEST),
    in_use("The specified port range is still in use by a server" BAD_REQUEST),
});

define_error!(route {
    not_found("The specified route was not found" NOT_FOUND),
    domain_not_found("The specified route domain was not found" NOT_FOUND),
    domain_exists("A route domain with this name already exists" BAD_REQUEST),
    domain_invalid("The specified route domain is invalid" BAD_REQUEST),
    domain_in_use("The route domain is still used by routes" BAD_REQUEST),
    domain_not_linked("The route domain is not linked to a Pangolin domain" BAD_REQUEST),
    subdomain_invalid("The specified subdomain is invalid" BAD_REQUEST),
    subdomain_taken("The specified subdomain is already taken" BAD_REQUEST),
    port_invalid("The selected port does not belong to this server" BAD_REQUEST),
    service_invalid("The port's name cannot be used as an SRV service name" BAD_REQUEST),
    zone_not_found("No Cloudflare zone carries the route domain" BAD_REQUEST),
    https_unavailable("HTTPS is not available for the selected domain" BAD_REQUEST),
    kind_unavailable("Routes of this kind are not configured on this instance" BAD_REQUEST),
    backend_unavailable("The route backend is currently unavailable" SERVICE_UNAVAILABLE),
    backend_error("The route backend rejected the request" BAD_GATEWAY),
});

define_error!(node {
    not_found("The specified node was not found" BAD_REQUEST),
    failure("Node operation failed" BAD_GATEWAY),
    invalid_host("The specified SSH host is invalid" BAD_REQUEST),
});

define_error!(feature {
    disabled("This feature is not enabled for the project" FORBIDDEN),
});

define_error!(region {
    not_found("The specified region was not found" NOT_FOUND),
    not_empty("Region still has nodes assigned" BAD_REQUEST),
    slug_invalid("The slug must be 1-64 characters of lowercase letters, numbers or hyphens" BAD_REQUEST),
    slug_taken("A region with this slug already exists" BAD_REQUEST),
});

define_error!(db {
    failure("Database operation failed" INTERNAL_SERVER_ERROR),
});

define_error!(database {
    not_found("The specified database was not found" NOT_FOUND),
    name_invalid("The database name must be 1-20 characters of lowercase letters or digits" BAD_REQUEST),
    name_taken("A database with this name already exists in the project" BAD_REQUEST),
    limit_exceeded("The project database limit has been reached" BAD_REQUEST),
    type_unavailable("No database host offers this database type" SERVICE_UNAVAILABLE),
    host_not_found("The specified database host was not found" NOT_FOUND),
    host_not_empty("The database host still has instances" BAD_REQUEST),
    instance_not_found("The specified database instance was not found" NOT_FOUND),
    instance_not_empty("The database instance still has project databases" BAD_REQUEST),
    agent_unreachable("The database agent is currently unreachable" SERVICE_UNAVAILABLE),
    agent_error("The database agent rejected the request" BAD_GATEWAY),
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
    file "The file path"
);

define_path_variable!(
    port_id "The port ID"
);

define_path_variable!(
    project_id "The project ID"
);

define_path_variable!(
    route_id "The route ID"
);

define_path_variable!(
    domain_id "The route domain ID"
);

define_path_variable!(
    user_id "The user ID"
);

define_path_variable!(
    region_id "The region ID"
);

define_path_variable!(
    database_id "The database ID"
);

define_path_variable!(
    host_id "The database host ID"
);

define_path_variable!(
    instance_id "The database instance ID"
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

define_path_variable!(
    file_name "The file name"
);

define_path_variable!(
    backup_storage "The backup storage ID"
);

define_path_variable!(
    backup_id "The backup ID"
);

define_query_variable!(
    content "The symlink target path"
);

define_query_variable!(
    limit "The optional response size limit"
);
