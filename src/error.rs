use axum::http::StatusCode;

pub(crate) type HttpError = (StatusCode, &'static str);

pub(crate) mod cache {
    use crate::error::*;

    pub(crate) const CACHE_UNREACHABLE: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Cache error: Cache server is unreachable",
    );
    pub(crate) const CACHE_DATA_ERROR: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Cache error: Something went wrong while accessing the cache",
    );
    pub(crate) const CACHE_MISSING: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Cache error: Cache is missing",
    );
}

pub(crate) mod server {
    use crate::error::*;

    pub(crate) const DAEMON_REQUEST_FAILED: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Server error: Daemon request failed",
    );
    pub(crate) const DAEMON_CONFIG_INVALID: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Server error: Internal Configuration is invalid",
    );

    pub(crate) const NOT_FOUND: HttpError = (StatusCode::NOT_FOUND, "Server not found");
}