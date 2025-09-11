use axum::http::StatusCode;

pub type HttpError = (StatusCode, &'static str);

pub mod cache {
    use crate::__deprecated_error::*;

    pub const CACHE_UNREACHABLE: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Cache error: Cache server is unreachable",
    );
    pub const CACHE_DATA_ERROR: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Cache error: Something went wrong while accessing the cache",
    );
    pub const CACHE_MISSING: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Cache error: Cache is missing",
    );
}

pub mod server {
    use crate::__deprecated_error::*;

    pub const DAEMON_REQUEST_FAILED: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Server error: Daemon request failed",
    );
    pub const DAEMON_CONFIG_INVALID: HttpError = (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Server error: Internal Configuration is invalid",
    );

    pub const NOT_FOUND: HttpError = (StatusCode::NOT_FOUND, "Server not found");
}
