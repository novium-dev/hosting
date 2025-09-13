use crate::Backend;
use daemon_framework::service;
use serde::{Deserialize, Serialize};
use crate::db::server::ServerId;
use crate::service::server::error::ConnectionTestError;
use super::*;

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
struct TestServer {
    id: ServerId,
    name: String,
}

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    #[route("/{server_id}", method = GET)]
    #[error(db(failed [sql:*]), server(not_found))]
    #[doc = "Tests the connection"]
    async fn connection_test(&self, server_id: ServerId) -> Result<TestServer, _> {
        let server = self.resolve_server(&self.database, server_id).await?.ok_or(
            ConnectionTestError::ServerNotFound
        )?;

        Ok(TestServer {
            id: server.id,
            name: server.name,
        })
    }
}
