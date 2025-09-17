use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{AccessPermission, ServerPermissions};
use crate::db::server::ServerId;
use crate::service::server::server_service_error::{ConnectionTestError, ServerTerminalError};
use serde::{Deserialize, Serialize};
use zelus::responses::Redirect;
use zelus::service;

define_error!(server {
    not_found("Server not found" NOT_FOUND),
    storage_not_found("The specified storage was not found" BAD_REQUEST),
});

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
struct TestServer {
    id: ServerId,
    name: String,
}

#[service(path = "/server/{server_id}", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    /// Tests the connection
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::VIEW`].
    #[route("", method = GET)]
    #[error(auth(permission_denied) db(failure [sql:*]) cache(failure [redis:*]) server(not_found))]
    async fn connection_test(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<TestServer, _> {
        auth.require::<ConnectionTestError>(AccessPermission::Server(
            server_id,
            ServerPermissions::VIEW,
        ))?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ConnectionTestError::ServerNotFound)?;

        Ok(TestServer {
            id: server.id,
            name: server.name,
        })
    }

    /// Redirects to an websocket url with terminal access
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::TERMINAL_READ`].
    /// Grants Write Permissions, if [`ServerPermissions::TERMINAL_WRITE`] is present.
    #[route("/terminal", method = GET, raw)]
    #[error(auth(permission_denied) db(failure [sql:*]) cache(failure [redis:*]) server(not_found))]
    async fn server_terminal(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Redirect<307>, _> {
        auth.require::<ServerTerminalError>(AccessPermission::Server(
            server_id,
            ServerPermissions::TERMINAL_READ,
        ))?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerTerminalError::ServerNotFound)?;

        Ok(Redirect::new(
            server
                .node
                .services
                .server_terminal_user_url_signed(
                    server.node_server_id,
                    None,
                    None, // Subject to potential change
                    auth.has(AccessPermission::Server(
                        server_id,
                        ServerPermissions::TERMINAL_WRITE,
                    )),
                )
                .as_str(),
        ))
    }
}
