use zelus::error::define_error;

define_error!(template {
    not_found ("The template does not exist" NOT_FOUND),
    missing ("The template used in the server does no longer exist" INTERNAL_SERVER_ERROR),
    corrupted ("The template was unable to read the server data" INTERNAL_SERVER_ERROR),
    unavailable ("The template is unavailable at the moment" SERVICE_UNAVAILABLE),
    port_definition_missing ("The template is missing a port definition" BAD_REQUEST),
    data_incomplete ("The template data is incomplete" BAD_REQUEST),
});
