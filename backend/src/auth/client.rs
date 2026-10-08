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
            .rfind(|entry| !entry.is_empty())
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
