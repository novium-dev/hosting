use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;
use crate::service::server::server_service_error::{
    KillServerError, RestartServerError, ServerInfoError, ServerStatsError, ServerTerminalError,
    StartServerError, StopServerError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use serde::{Deserialize, Serialize};
use sqlx::query;
use tracing::error;
use zelus::responses::Redirect;
use zelus::service;

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
struct ServerInfo {
    id: ServerId,
    name: String,
}

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    /// Lists all servers you have access to.
    ///
    /// Only servers in which you have the [`ServerPermissions::VIEW`] permission are listed.
    #[route("", method = GET, raw)]
    #[error(db::failure <- [sql:*], cache::failure <- [redis:*])]
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
    #[route("/{server_id}", method = GET)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
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
    #[route("/{server_id}/terminal", method = GET, raw)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
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
    #[route("/{server_id}/stats", method = GET, raw)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
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

    /// Tries to start the server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/start", method = GET)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn start_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::StartServerError as DaemonStartServerError;

        auth.require::<_, StartServerError>(server_id, ServerPermissions::POWER)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(StartServerError::ServerNotFound)?;

        server
            .node
            .start_server(server.node_server_id)
            .await
            .map_err(|err| match err {
                err @ (DaemonStartServerError::Communication(_)
                | DaemonStartServerError::AuthInvalid
                | DaemonStartServerError::SqlFailure
                | DaemonStartServerError::ServerNotFound) => {
                    error!("Failed to start server: {err:?}");
                    StartServerError::NodeFailure
                }
            })
    }

    /// Tries to stop the server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/stop", method = GET)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn stop_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::StopServerError as DaemonStopServerError;

        auth.require::<_, StopServerError>(server_id, ServerPermissions::POWER)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(StopServerError::ServerNotFound)?;

        server
            .node
            .stop_server(server.node_server_id)
            .await
            .map_err(|err| match err {
                err @ (DaemonStopServerError::Communication(_)
                | DaemonStopServerError::AuthInvalid
                | DaemonStopServerError::SqlFailure
                | DaemonStopServerError::ServerNotFound) => {
                    error!("Failed to stop server: {err:?}");
                    StopServerError::NodeFailure
                }
            })
    }

    /// Tries to restart the server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/restart", method = GET)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn restart_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::RestartServerError as DaemonRestartServerError;

        auth.require::<_, RestartServerError>(server_id, ServerPermissions::POWER)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(RestartServerError::ServerNotFound)?;

        server
            .node
            .restart_server(server.node_server_id)
            .await
            .map_err(|err| match err {
                err @ (DaemonRestartServerError::Communication(_)
                | DaemonRestartServerError::AuthInvalid
                | DaemonRestartServerError::SqlFailure
                | DaemonRestartServerError::ServerNotFound) => {
                    error!("Failed to restart server: {err:?}");
                    RestartServerError::NodeFailure
                }
            })
    }

    /// Tries to kill the server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/kill", method = GET)]
    #[error(auth::permission_denied, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn kill_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::KillServerError as DaemonKillServerError;

        auth.require::<_, KillServerError>(server_id, ServerPermissions::POWER)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(KillServerError::ServerNotFound)?;

        server
            .node
            .kill_server(server.node_server_id)
            .await
            .map_err(|err| match err {
                err @ (DaemonKillServerError::Communication(_)
                | DaemonKillServerError::AuthInvalid
                | DaemonKillServerError::SqlFailure
                | DaemonKillServerError::ServerNotFound) => {
                    error!("Failed to restart server: {err:?}");
                    KillServerError::NodeFailure
                }
            })
    }
}
