use core::net::SocketAddr;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Debug)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
}
