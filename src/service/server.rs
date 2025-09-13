use crate::Backend;
use daemon_framework::service;

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {}
