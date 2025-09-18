use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;
use crate::service::server::server_service_error::{
    ServerInfoError, ServerStatsError, ServerTerminalError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use serde::{Deserialize, Serialize};
use sqlx::query;
use zelus::responses::Redirect;
use zelus::service;

define_error!(server {
    not_found("Server not found" NOT_FOUND),
    storage_not_found("The specified storage was not found" BAD_REQUEST),
});

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
struct ServerInfo {
    id: ServerId,
    name: String,
}

#[service(path = "/server/{server_id}", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    /// Lists all servers you have access to.
    ///
    /// Only servers in which you have the [`ServerPermissions::VIEW`] permission are listed.
    #[route(!"/server", method = GET, raw)]
    #[error(db(failure [sql:*]) cache(failure [redis:*]))]
    async fn list_servers(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
    ) -> Result<Paged<ServerInfo>, _> {
        Ok(
            query!("SELECT `id` AS `id: ServerId`, `name` FROM `servers`")
                .fetch_all(&*self.database)
                .await?
                .into_iter()
                .filter(|server| auth.has(server.id, ServerPermissions::VIEW))
                .apply_pagesplit(&mut page)
                .map(|server| ServerInfo {
                    id: server.id,
                    name: server.name,
                })
                .collect_paged(page),
        )
    }

    /// Shows information about a specific server.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::VIEW`].
    #[route("", method = GET)]
    #[error(auth(permission_denied) db(failure [sql:*]) cache(failure [redis:*]) server(not_found))]
    async fn server_info(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<ServerInfo, _> {
        auth.require::<_, ServerInfoError>(server_id, ServerPermissions::VIEW)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerInfoError::ServerNotFound)?;

        Ok(ServerInfo {
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
        auth.require::<_, ServerTerminalError>(server_id, ServerPermissions::TERMINAL_READ)?;
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
                    auth.has(server_id, ServerPermissions::TERMINAL_WRITE),
                )
                .as_str(),
        ))
    }

    /// Redirects to an websocket url with stats updates (status and resource usage)
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::VIEW`].
    #[route("/stats", method = GET, raw)]
    #[error(auth(permission_denied) db(failure [sql:*]) cache(failure [redis:*]) server(not_found))]
    async fn server_stats(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Redirect<307>, _> {
        auth.require::<_, ServerStatsError>(server_id, ServerPermissions::VIEW)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerStatsError::ServerNotFound)?;

        Ok(Redirect::new(
            server
                .node
                .services
                .server_stats_user_url_signed(server.node_server_id)
                .as_str(),
        ))
    }
}
