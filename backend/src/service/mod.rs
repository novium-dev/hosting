use zelus::error::define_error;
use zelus::{define_path_variable, define_query_variable};

pub(crate) mod admin;
pub(crate) mod api_key;
pub(crate) mod auth;
pub(crate) mod backup;
pub(crate) mod database;
pub(crate) mod file;
pub(crate) mod instance;
pub(crate) mod internal;
pub(crate) mod minecraft;
pub(crate) mod modpack;
pub(crate) mod profile;
pub(crate) mod project;
pub(crate) mod resource;
pub(crate) mod route;
pub(crate) mod schedule;
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
    config_invalid("The server config file is invalid" BAD_REQUEST),
    startup_unsupported("The server's template does not support a custom startup command" BAD_REQUEST),
    startup_invalid("The startup command must be 1-4000 characters without control characters" BAD_REQUEST),
    environment_unsupported("The server's template does not support custom environment variables" BAD_REQUEST),
    environment_invalid("An environment variable name or value is invalid, reserved or too long" BAD_REQUEST),
    env_file_invalid("The environment file must be a relative path inside the server directory" BAD_REQUEST)
});

define_error!(project {
    not_found("Project not found" NOT_FOUND),
    not_empty("Project still has servers or databases" BAD_REQUEST),
    slug_invalid("The slug must be 1-64 characters of lowercase letters, numbers or hyphens, and must not be reserved" BAD_REQUEST),
    expiry_invalid("The membership expiry must be in the future" BAD_REQUEST),
    owner_immutable("The project owner cannot be modified or removed" BAD_REQUEST),
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
    sources_empty("No files or directories were selected" BAD_REQUEST),
    mode_invalid("The specified file mode is invalid" BAD_REQUEST),
    owner_missing("Neither a user nor a group was specified" BAD_REQUEST),
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

define_error!(schedule {
    not_found("The specified schedule was not found" NOT_FOUND),
    name_invalid("The schedule name must be 1-64 characters" BAD_REQUEST),
    cron_invalid("The cron expression is invalid" BAD_REQUEST),
    timezone_invalid("The timezone is not a known IANA timezone" BAD_REQUEST),
    tasks_invalid("A schedule needs between 1 and 32 steps, each with a non-empty command" BAD_REQUEST),
    minecraft_unsupported("The server does not accept Minecraft commands" BAD_REQUEST),
    not_synchronized("The schedule is disabled and therefore not on the node" BAD_REQUEST),
    limit_exceeded("The server schedule limit has been reached" BAD_REQUEST),
});

define_error!(node {
    not_found("The specified node was not found" BAD_REQUEST),
    not_empty("Node still has servers assigned" BAD_REQUEST),
    failure("Node operation failed" BAD_GATEWAY),
    invalid_host("The specified SSH host is invalid" BAD_REQUEST),
});

define_error!(feature {
    disabled("This feature is not enabled for the project" FORBIDDEN),
});

define_error!(integrity {
    already_running("An integrity run is already in progress" CONFLICT),
});

define_error!(license {
    not_found("The specified license is not required by this server" NOT_FOUND),
    not_accepted("A license required by this server has not been accepted yet" BAD_REQUEST),
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
    name_invalid("The name must be 1-63 ascii alphanumeric characters" BAD_REQUEST),
    limit_exceeded("The project database instance limit has been reached" BAD_REQUEST),
    type_unavailable("No database host can currently offer this database type" SERVICE_UNAVAILABLE),
    host_not_found("The specified database host was not found" NOT_FOUND),
    host_not_empty("The database host still has instances" BAD_REQUEST),
    instance_not_found("The specified database instance was not found" NOT_FOUND),
    user_not_found("The specified database user was not found" NOT_FOUND),
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
    license_id "The license ID"
);

define_path_variable!(
    port_id "The port ID"
);

define_path_variable!(
    schedule_id "The schedule ID"
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

define_query_variable!(
    mode "The file mode as an unsigned integer"
);

define_query_variable!(
    uid "The owning user ID"
);

define_query_variable!(
    gid "The owning group ID"
);
