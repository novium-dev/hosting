use crate::Backend;
use crate::auth::session::SESSION_COOKIE_NAME;
use axum::extract::{Extension, Request};
use axum::http::{Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse as _, Response};
use url::{Origin, Url};

fn has_session_cookie(request: &Request) -> bool {
    request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|cookie| {
            cookie
                .split(';')
                .any(|pair| pair.trim().starts_with(&format!("{SESSION_COOKIE_NAME}=")))
        })
}

fn matches_any_origin(allowed: &[Origin], candidate: &str) -> bool {
    Url::parse(candidate).is_ok_and(|url| allowed.contains(&url.origin()))
}

fn source_allowed(request: &Request, allowed: &[Origin]) -> bool {
    let headers = request.headers();

    if let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        return matches_any_origin(allowed, origin);
    }

    headers
        .get(header::REFERER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|referer| matches_any_origin(allowed, referer))
}

pub async fn verify_origin(
    Extension(backend): Extension<Backend>,
    request: Request,
    next: Next,
) -> Response {
    let unsafe_method = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );

    if unsafe_method
        && has_session_cookie(&request)
        && !source_allowed(&request, &backend.config.allowed_origins())
    {
        return StatusCode::FORBIDDEN.into_response();
    }

    next.run(request).await
}
