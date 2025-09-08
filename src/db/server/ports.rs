use std::ops::RangeInclusive;
use serde::{Deserialize, Serialize};

#[derive(Clone, Eq, PartialEq)]
pub struct ServerPort {
    pub host: String,
    pub name: String,
    pub protocol: NetworkProtocol,
    pub internal_port: u16,
    pub external_port: RangeInclusive<u16>,
    pub bind: Option<String>,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum NetworkProtocol {
    #[serde(rename = "tcp")]
    TCP,
    #[serde(rename = "udp")]
    UDP,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub(crate) struct NetworkPort {
    pub(crate) host: String,
    pub(crate) name: String, // only for ux purposes
    pub(crate) external_port_start: u16,
    pub(crate) external_port_end: u16,
    pub(crate) internal_port: u16,
    pub(crate) protocol: NetworkProtocol,
    pub(crate) bind: Option<String>, // Only visible to admins
}