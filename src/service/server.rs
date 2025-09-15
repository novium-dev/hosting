use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::db::server::ServerId;
use crate::service::server::server_service_error::ConnectionTestError;
use serde::{Deserialize, Serialize};
use zelus::service;

define_error!(server {
    not_found("Server not found" NOT_FOUND),
    daemon_request_failed("Request to daemon failed" BAD_GATEWAY),
    storage_not_found("The specified storage was not found" BAD_REQUEST),
});

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
struct TestServer {
    id: ServerId,
    name: String,
}

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    #[route("/{server_id}", method = GET)]
    #[error(db(failure [sql:*]) cache(failure [redis:*]) server(not_found))]
    #[doc = "Tests the connection"]
    async fn connection_test(
        &self,
        #[special] _auth: Authentication,
        server_id: ServerId,
    ) -> Result<TestServer, _> {
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ConnectionTestError::ServerNotFound)?;

        Ok(TestServer {
            id: server.id,
            name: server.name,
        })
    }
}
