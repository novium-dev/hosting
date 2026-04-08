use std::collections::HashSet;

use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;
use crate::db::server::ports::NetworkPort;
use crate::service::server::server_service_error::{
    KillServerError, RestartServerError, ServerInfoError, ServerStatsError, ServerTerminalError,
    StartServerError, StopServerError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use serde::{Deserialize, Serialize};
use sqlx::query;
use tracing::error;
use uuid::Uuid;
use zelus::service;

#[derive(Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct ServerListInfo {
    id: ServerId,
    name: String,
    owner: String,
    node: String, // Name
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct LightNodeInfo {
    pub(crate) id: u32,
    pub(crate) uuid: Uuid,
    pub(crate) display: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct PrimaryPortInfo {
    pub(crate) port: NetworkPort,
    pub(crate) external_port: u16,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerInfo {
    pub(crate) id: ServerId,
    pub(crate) name: String,
    pub(crate) owner: Uuid,
    pub(crate) node: LightNodeInfo,
    pub(crate) template: String,
    pub(crate) cpu: Option<f32>,
    pub(crate) ram: Option<u32>,
    pub(crate) swap: Option<u32>,
    pub(crate) disk: Option<u64>,
    //pub(crate) network: Option<ServerNetworkInfo>,
    //pub(crate) database: Option<Vec<DatabaseAssignmentInfo>>,
    pub(crate) features: HashSet<&'static str>,
    pub(crate) group: Option<String>,
    pub(crate) suspended: bool,
    pub(crate) primary_port: Option<PrimaryPortInfo>,
}

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    /// Lists all servers you have access to.
    ///
    /// Only servers in which you have the [`ServerPermissions::VIEW`] permission are listed.
    #[route("", method = GET, raw, query = [ owner ])]
    #[error(auth::unreachable, db::failure <- [sql:*], cache::failure <- [redis:*])]
    async fn list_servers(
        &self,
        owner: Option<String>,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
    ) -> Result<Paged<ServerListInfo>, _> {
        let servers = query!("SELECT `id` AS `id: ServerId`, `name`, `owner`, `node` AS `node: uuid::fmt::Hyphenated` FROM `servers`")
            .fetch_all(&*self.database)
            .await?
            .into_iter()
            .filter(|server| owner.as_ref().is_none_or(|owner| server.owner == *owner))
            .filter(|server| auth.has(server.id, ServerPermissions::VIEW))
            .apply_pagesplit(&mut page)
            .collect::<Vec<_>>();

        let nodes = self.nodes.read().await;

        Ok(servers
            .into_iter()
            .map(|server| ServerListInfo {
                id: server.id,
                name: server.name,
                owner: server.owner,
                node: nodes
                    .get(&server.node.as_uuid())
                    .map(|node| node.display.clone())
                    .unwrap_or_else(|| "Unknown Node".to_string()),
            })
            .collect_paged(page))
    }

    /// Shows information about a specific server.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::VIEW`].
    #[route("/{server_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
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

        let primary_port = server
            .primary_port(&mut ctx)
            .await?
            .map(|(id, port, external_port)| PrimaryPortInfo {
                port: NetworkPort {
                    id,
                    name: port.name,
                    protocol: port.protocol,
                    internal_port: port.internal_port,
                    external_port_start: *port.external_port.start(),
                    external_port_end: *port.external_port.end(),
                    host: port.host,
                    bind: port.bind,
                },
                external_port,
            });

        Ok(ServerInfo {
            id: server.id,
            name: server.name,
            owner: server.owner,
            address: server.node,
        })
    }

    /// Redirects to an websocket url with terminal access
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::TERMINAL_READ`].
    /// Grants Write Permissions, if [`ServerPermissions::TERMINAL_WRITE`] is present.
    #[route("/{server_id}/terminal", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
    async fn server_terminal(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<String, _> {
        auth.require::<_, ServerTerminalError>(server_id, ServerPermissions::TERMINAL_READ)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerTerminalError::ServerNotFound)?;

        let url = server
            .node
            .services
            .server_terminal_user_url_signed(
                server.node_server_id,
                None,
                None, // Subject to potential change
                auth.has(server_id, ServerPermissions::TERMINAL_WRITE),
            )
            .as_str()
            .to_string();

        Ok(url)
    }

    /// Redirects to an websocket url with stats updates (status and resource usage)
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::VIEW`].
    #[route("/{server_id}/stats", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
    async fn server_stats(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<String, _> {
        auth.require::<_, ServerStatsError>(server_id, ServerPermissions::VIEW)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerStatsError::ServerNotFound)?;

        let url = server
            .node
            .services
            .server_stats_user_url_signed(server.node_server_id)
            .as_str()
            .to_string();

        Ok(url)
    }

    /// Tries to start the server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/start", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
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
