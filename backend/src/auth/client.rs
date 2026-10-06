use axum::extract::ConnectInfo;
use core::net::SocketAddr;
use http::header::USER_AGENT;
use http::request::Parts;
use http::{HeaderMap, HeaderName};
use utoipa::openapi::path::OperationBuilder;
use zelus::special::FromRequestParts;
use zelus::types::DocumentedType;

const USER_AGENT_LIMIT: usize = 512;
const IP_LIMIT: usize = 64;

const FORWARDED_FOR: HeaderName = HeaderName::from_static("x-forwarded-for");
const REAL_IP: HeaderName = HeaderName::from_static("x-real-ip");

#[derive(Debug, Default)]
pub struct ClientInfo {
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

fn truncate(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn header_value(headers: &HeaderMap, name: &HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn client_ip(parts: &Parts) -> Option<String> {
    let forwarded = header_value(&parts.headers, &FORWARDED_FOR).and_then(|value| {
        value
            .split(',')
            .map(str::trim)
            .find(|entry| !entry.is_empty())
            .map(ToOwned::to_owned)
    });

    forwarded
        .or_else(|| header_value(&parts.headers, &REAL_IP))
        .or_else(|| {
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ConnectInfo(address)| address.ip().to_string())
        })
        .map(|ip| truncate(&ip, IP_LIMIT))
}

impl<E> FromRequestParts<E> for ClientInfo {
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        let user_agent = header_value(&parts.headers, &USER_AGENT)
            .map(|user_agent| truncate(&user_agent, USER_AGENT_LIMIT));

        Ok(Self {
            user_agent,
            ip: client_ip(parts),
        })
    }
}

impl DocumentedType for ClientInfo {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations
    }
}

#[cfg(test)]
mod tests {
    use super::client_ip;
    use http::Request;

    fn parts(headers: &[(&str, &str)]) -> http::request::Parts {
        let mut builder = Request::builder();
        for &(name, value) in headers {
            builder = builder.header(name, value);
        }

        builder.body(()).expect("request").into_parts().0
    }

    #[test]
    fn prefers_the_first_forwarded_address() {
        let parts = parts(&[("x-forwarded-for", "203.0.113.9, 10.0.0.1")]);

        assert_eq!(client_ip(&parts).as_deref(), Some("203.0.113.9"));
    }

    #[test]
    fn falls_back_to_the_real_ip_header() {
        let parts = parts(&[("x-real-ip", "203.0.113.9")]);

        assert_eq!(client_ip(&parts).as_deref(), Some("203.0.113.9"));
    }
}
