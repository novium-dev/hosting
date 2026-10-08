use crate::Backend;
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use chrono::Utc;
use daemon_common::DAEMON_KEY_PREFIX;
use http::header::AUTHORIZATION;
use http::request::Parts;
use http::{HeaderMap, HeaderName};
use rustls::SignatureScheme;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tracing::debug;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use uuid::Uuid;
use webpki::{EndEntityCert, KeyUsage};
use zelus::special::FromRequestParts;
use zelus::types::DocumentedType;

const CERTIFICATE_HEADER: HeaderName = HeaderName::from_static("x-novium-node-certificate");
const SIGNATURE_HEADER: HeaderName = HeaderName::from_static("x-novium-node-signature");
const SCHEME_HEADER: HeaderName = HeaderName::from_static("x-novium-node-signature-scheme");
const TIMESTAMP_HEADER: HeaderName = HeaderName::from_static("x-novium-node-timestamp");

const SIGNATURE_CONTEXT: &str = "novium-node-auth";
const MAX_CLOCK_SKEW: i64 = 300;

#[derive(Debug, Default)]
pub struct NodeSignature {
    certificate: Option<String>,
    signature: Option<String>,
    scheme: Option<String>,
    timestamp: Option<String>,
    authorization: Option<String>,
}

fn header(headers: &HeaderMap, name: &HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

impl NodeSignature {
    pub async fn verify(&self, backend: &Backend, node: Uuid) -> bool {
        if !backend.nodes.read().await.contains_key(&node) {
            debug!("Rejected a signed node request for unknown node {node}");
            return false;
        }

        self.verify_for(backend, node).is_some()
    }

    fn verify_for(&self, backend: &Backend, node: Uuid) -> Option<()> {
        let timestamp = self.timestamp.as_deref()?.parse::<i64>().ok()?;
        if (Utc::now().timestamp() - timestamp).abs() > MAX_CLOCK_SKEW {
            return None;
        }

        let certificate =
            CertificateDer::from(BASE64_STANDARD.decode(self.certificate.as_deref()?).ok()?);
        let signature = BASE64_STANDARD.decode(self.signature.as_deref()?).ok()?;
        let scheme = SignatureScheme::from(self.scheme.as_deref()?.parse::<u16>().ok()?);

        let cert = EndEntityCert::try_from(&certificate).ok()?;
        let anchors = [webpki::anchor_from_trusted_cert(&backend.root_key.tls_ca)
            .ok()?
            .to_owned()];
        let algorithms =
            rustls::crypto::aws_lc_rs::default_provider().signature_verification_algorithms;

        cert.verify_for_usage(
            algorithms.all,
            &anchors,
            &[],
            UnixTime::now(),
            KeyUsage::server_auth(),
            None,
            None,
        )
        .inspect_err(|err| debug!("Rejected node certificate: {err:?}"))
        .ok()?;

        let name = ServerName::try_from(zelus_keys::server_name(DAEMON_KEY_PREFIX, node)).ok()?;
        cert.verify_is_valid_for_subject_name(&name)
            .inspect_err(|err| debug!("Node certificate does not belong to {node}: {err:?}"))
            .ok()?;

        let message = signed_message(timestamp, self.authorization.as_deref().unwrap_or_default());
        let (_, candidates) = algorithms
            .mapping
            .iter()
            .find(|(candidate, _)| *candidate == scheme)?;

        candidates
            .iter()
            .any(|algorithm| {
                cert.verify_signature(*algorithm, message.as_bytes(), &signature)
                    .is_ok()
            })
            .then_some(())
    }
}

fn signed_message(timestamp: i64, authorization: &str) -> String {
    format!("{SIGNATURE_CONTEXT}\n{timestamp}\n{authorization}")
}

impl<E> FromRequestParts<E> for NodeSignature {
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        let headers = &parts.headers;
        Ok(Self {
            certificate: header(headers, &CERTIFICATE_HEADER),
            signature: header(headers, &SIGNATURE_HEADER),
            scheme: header(headers, &SCHEME_HEADER),
            timestamp: header(headers, &TIMESTAMP_HEADER),
            authorization: header(headers, &AUTHORIZATION),
        })
    }
}

fn string_header(name: &HeaderName, description: &str) -> ParameterBuilder {
    ParameterBuilder::new()
        .name(name.as_str())
        .parameter_in(ParameterIn::Header)
        .description(Some(description))
        .schema(Some(RefOr::T(Schema::Object(
            Object::builder()
                .schema_type(SchemaType::Type(Type::String))
                .build(),
        ))))
        .required(Required::True)
}

impl DocumentedType for NodeSignature {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations
            .parameter(string_header(
                &CERTIFICATE_HEADER,
                "The node's certificate, DER encoded as base64",
            ))
            .parameter(string_header(
                &SIGNATURE_HEADER,
                "The signature over the timestamp and the Authorization header, as base64",
            ))
            .parameter(string_header(
                &SCHEME_HEADER,
                "The TLS signature scheme the signature was made with",
            ))
            .parameter(string_header(
                &TIMESTAMP_HEADER,
                "The unix timestamp the request was signed at",
            ))
    }
}
