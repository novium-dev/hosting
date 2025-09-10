use core::ops::RangeInclusive;
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
    Tcp,
    #[serde(rename = "udp")]
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct NetworkPort {
    pub host: String,
    pub name: String, // only for ux purposes
    pub external_port_start: u16,
    pub external_port_end: u16,
    pub internal_port: u16,
    pub protocol: NetworkProtocol,
    pub bind: Option<String>, // Only visible to admins
}
