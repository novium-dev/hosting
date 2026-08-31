#![forbid(unsafe_code)]

/// Fingerprint of the service definitions this crate was built from.
///
/// The agent reports it so the backend can tell a host built against a
/// different API surface from one that merely sits on a different commit.
pub const API_HASH: &str = env!("API_HASH");

pub mod identifier;
pub mod integrity;
#[cfg(feature = "sdk")]
pub mod sdk;
#[cfg(feature = "service")]
pub mod service;
pub mod types;
