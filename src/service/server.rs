use std::collections::{HashMap, HashSet};

use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::db::server::ports::{NetworkPort, NetworkProtocol, ServerPort};
use crate::service::server::server_service_error::{
    KillServerError, RestartServerError, ServerInfoError, ServerStatsError, ServerTerminalError,
    ServerVariablesError, StartServerError, StopServerError, UpdateServerError,
    UpdateVariablesError,
};
use crate::service::template::*;
use crate::templates::TemplateError;
use crate::templates::variable::VariablePayload;
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use daemon_common::service::server::{ServerNetworkPayload, ServerResourcePayload};
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query};
use tracing::{error, warn};
use uuid::Uuid;
use zelus::{define_query_variable, service};

define_query_variable!(project "The project");
define_query_variable!(node "The node");
define_query_variable!(template "The template");

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerListInfo {
    id: ServerId,
    name: String,
    project: ProjectId,
    template: String,
    node: String, // Name
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct LightNodeInfo {
    pub(crate) id: Uuid,
    pub(crate) display: String,
    pub(crate) maintenance: bool,
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
    pub(crate) project: ProjectId,
    pub(crate) node: LightNodeInfo,
    pub(crate) template: String,
    pub(crate) limits: ServerLimits,
    pub(crate) cpu: Option<f32>,
    pub(crate) ram: Option<u32>,
    pub(crate) swap: Option<u32>,
    pub(crate) disk: Option<u64>,
    pub(crate) network: Option<ServerNetworkInfo>,
    //pub(crate) database: Option<Vec<DatabaseAssignmentInfo>>,
    pub(crate) features: HashSet<&'static str>,
    pub(crate) internet_access: bool,
    pub(crate) suspended: bool,
    pub(crate) primary_port: Option<PrimaryPortInfo>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerNetworkInfo {
    pub(crate) ports: Vec<NetworkPort>,
    //pub(crate) networks: Vec<NetworkAssignmentInfo>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerLimits {
    pub(crate) backup: Option<u32>,
}

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    /// Lists all servers you have access to.
    ///
    /// Only servers in which you have the [`ProjectPermissions::VIEW`] permission are listed.
    #[route("", method = GET, raw, query = [project, node, template])]
    #[error(auth::unreachable, db::failure <- [sql:*])]
    async fn list_servers(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
        project: Option<ProjectId>,
        node: Option<Uuid>,
        template: Option<String>,
    ) -> Result<Paged<ServerListInfo>, _> {
        let servers = query!(r#"SELECT id AS "id: ServerId", name, project AS "project: ProjectId", node, template FROM servers"#)
            .fetch_all(&*self.database)
            .await?
            .into_iter()

            .filter(|server| project.is_none_or(|owner| *server.project == *owner))
            .filter(|server| node.as_ref().is_none_or(|node| server.node == *node))
            .filter(|server| template.as_ref().is_none_or(|template| server.template == *template))
            .filter(|server| auth.has(server.id, ProjectPermissions::VIEW))
            .apply_pagesplit(&mut page)
            .collect::<Vec<_>>();

        let nodes = self.nodes.read().await;

        let templates = self.templates.read().await;

        Ok(servers
            .into_iter()
            .map(|server| ServerListInfo {
                id: server.id,
                name: server.name,
                project: server.project,
                template: templates
                  .get(&server.template).map_or_else(|| {
                        warn!(
                        "Found server whose template is not in the templates cache: {}, template: {}",
                            server.id, server.template
                         );
                        "Unknown Template".to_owned()
                   }, |template| template.id().to_owned()),
                node: nodes.get(&server.node).map_or_else(
                    || {
                        warn!(
                            "Found server whose node is not in the nodes cache: {}, node: {}",
                            server.id, server.node
                        );
                        "Unknown Node".to_owned()
                    },
                    |node| node.display.clone(),
                ),
            })
            .collect_paged(page))
    }

    /// Shows information about a specific server.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`].
    #[route("/{server_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, template::{corrupted, unavailable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
    async fn server_info(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<ServerInfo, _> {
        auth.require::<_, _, ServerInfoError>(server_id, ProjectPermissions::VIEW)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerInfoError::ServerNotFound)?;

        let ports = query!(
            r#"SELECT
            	id,
            	name,
            	host,
                protocol AS "protocol: NetworkProtocol",
                external_ip,
                internal_port,
                external_port_start,external_port_end
            FROM server_ports WHERE server = $1"#,
            server_id.as_str()
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|record| {
            (
                record.id.cast_unsigned(),
                ServerPort {
                    host: record.host,
                    bind: auth
                        .has((), ManagementPermissions::SERVER_MANAGE)
                        .then_some(record.external_ip),
                    name: record.name,
                    protocol: record.protocol,
                    internal_port: u16::try_from(record.internal_port)
                        .expect("database port constraints ensure a u16 value"),
                    external_port: u16::try_from(record.external_port_start)
                        .expect("database port constraints ensure a u16 value")
                        ..=u16::try_from(record.external_port_end)
                            .expect("database port constraints ensure a u16 value"),
                },
            )
        })
        .collect();

        let primary_port = server
            .template
            .primary_port(self.cache.clone(), server.template_extra.clone(), &ports)
            .await
            .map_err(TemplateError::into::<ServerInfoError>)?
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

        let network = auth
            .has(server_id, ServerPermissions::NETWORK_VIEW)
            .then(|| {
                let ports = ports
                    .iter()
                    .map(|(id, port)| NetworkPort {
                        id: *id,
                        name: port.name.clone(),
                        protocol: port.protocol,
                        internal_port: port.internal_port,
                        external_port_start: *port.external_port.start(),
                        external_port_end: *port.external_port.end(),
                        host: port.host.clone(),
                        bind: port.bind.clone(),
                    })
                    .collect();

                ServerNetworkInfo { ports }
            });

        Ok(ServerInfo {
            id: server.id,
            name: server.name,
            project: server.project,
            cpu: server.cpu,
            ram: server.ram,
            swap: server.swap,
            disk: server.disk,
            network,
            template: server.template.id().to_owned(),
            features: server
                .template
                .enabled_features(self.cache.clone(), server.template_extra)
                .await
                .map_err(TemplateError::into::<ServerInfoError>)?,
            limits: ServerLimits {
                backup: server.backup_limit,
            },
            internet_access: server.internet_access,
            primary_port,
            node: LightNodeInfo {
                id: server.node.id,
                display: server.node.display.clone(),
                maintenance: server.node.maintenance,
            },
            suspended: server.suspended,
        })
    }

    /// Updates server metadata and runtime limits.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`].
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`] to rename a server.
    /// Requires [`ManagementPermissions::SERVER_MANAGE`] to update resources, internet access,
    /// backup limits or custom dockerfile.
    /// Requires [`ManagementPermissions::SERVER_SUSPEND`] to (un)suspend a server.
    #[route("/{server_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn update_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        name: Option<String>,
        resource: Option<ServerResourcePayload>,
        custom_dockerfile: Option<String>,
        suspended: Option<bool>,
        internet_access: Option<bool>,
        limits: Option<ServerLimits>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateServerError>(server_id, ProjectPermissions::VIEW)?;

        if name.is_some() {
            auth.require::<_, _, UpdateServerError>(
                server_id,
                ProjectPermissions::ADMIN_MANAGEMENT,
            )?;
        }

        if resource.is_some()
            || internet_access.is_some()
            || custom_dockerfile.is_some()
            || limits.is_some()
        {
            auth.require::<_, _, UpdateServerError>((), ManagementPermissions::SERVER_MANAGE)?;
        }

        if suspended.is_some() {
            auth.require::<_, _, UpdateServerError>((), ManagementPermissions::SERVER_SUSPEND)?;
        }

        let backup_limit = limits.map(|limits| limits.backup);
        let custom_dockerfile = custom_dockerfile.map(|dockerfile| {
            if dockerfile.is_empty() {
                None
            } else {
                Some(dockerfile)
            }
        });

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateServerError::ServerNotFound)?;

        if resource.is_some() || internet_access.is_some() {
            server
                .node
                .update_server(
                    server.node_server_id,
                    resource.clone(),
                    None,
                    None,
                    internet_access.map(|internet_access| ServerNetworkPayload {
                        internet_access,
                        networks: Vec::new(),
                    }),
                )
                .await
                .map_err(|err| {
                    error!("Failed to update server: {err:?}");
                    UpdateServerError::NodeFailure
                })?;
        }

        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                if let Some(name) = name {
                    query!(
                        "UPDATE servers SET name = $1 WHERE id = $2",
                        name,
                        server_id.as_str()
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to update server (name): {err:?}"))?;
                }

                if let Some(resource) = resource {
                    query!(
                        "UPDATE servers SET cpu = $1, ram = $2, swap = $3, disk = $4 WHERE id = $5",
                        resource.cpu,
                        resource.ram.map(u32::cast_signed),
                        resource.swap.map(u32::cast_signed),
                        resource.disk.map(u64::cast_signed),
                        server_id.as_str()
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to update server (resource): {err:?}"))?;
                }

                if let Some(custom_dockerfile) = custom_dockerfile {
                    query!(
                        "UPDATE servers SET custom_dockerfile = $1 WHERE id = $2",
                        custom_dockerfile,
                        server_id.as_str()
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| {
                        error!("Failed to update server (custom_dockerfile): {err:?}");
                    })?;
                }

                if let Some(suspended) = suspended {
                    query!(
                        "UPDATE servers SET suspended = $1 WHERE id = $2",
                        suspended,
                        server_id.as_str()
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| {
                        error!("Failed to update server (suspended): {err:?}");
                    })?;
                }

                if let Some(internet_access) = internet_access {
                    query!(
                        "UPDATE servers SET internet_access = $1 WHERE id = $2",
                        internet_access,
                        server_id.as_str()
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| {
                        error!("Failed to update server (internet_access): {err:?}");
                    })?;
                }

                if let Some(backup_limit) = backup_limit {
                    query!(
                        "UPDATE servers SET backup_limit = $1 WHERE id = $2",
                        backup_limit.map(u32::cast_signed),
                        server_id.as_str()
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| {
                        error!("Failed to update server (backup_limit): {err:?}");
                    })?;
                }

                Ok::<(), UpdateServerError>(())
            })
        })
        .await?;

        if suspended == Some(true) {
            let _ =
                tokio::task::spawn(
                    async move { server.node.stop_server(server.node_server_id).await },
                )
                .await;
        }

        Ok(())
    }

    /// Redirects to an websocket url with terminal access
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::TERMINAL_READ`].
    /// Grants Write Permissions, if [`ServerPermissions::TERMINAL_WRITE`] is present.
    #[route("/{server_id}/terminal", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn server_terminal(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<String, _> {
        auth.require::<_, _, ServerTerminalError>(server_id, ServerPermissions::TERMINAL_READ)?;
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
            .to_string();

        Ok(url)
    }

    /// Redirects to an websocket url with stats updates (status and resource usage)
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`].
    #[route("/{server_id}/stats", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn server_stats(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<String, _> {
        auth.require::<_, _, ServerStatsError>(server_id, ProjectPermissions::VIEW)?;
        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerStatsError::ServerNotFound)?;

        let url = server
            .node
            .services
            .server_stats_user_url_signed(server.node_server_id)
            .to_string();

        Ok(url)
    }

    /// Tries to start the server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/start", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure)]
    async fn start_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::StartServerError as DaemonStartServerError;

        auth.require::<_, _, StartServerError>(server_id, ServerPermissions::POWER)?;
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure)]
    async fn stop_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::StopServerError as DaemonStopServerError;

        auth.require::<_, _, StopServerError>(server_id, ServerPermissions::POWER)?;
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure)]
    async fn restart_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::RestartServerError as DaemonRestartServerError;

        auth.require::<_, _, RestartServerError>(server_id, ServerPermissions::POWER)?;
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, node::failure)]
    async fn kill_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        use daemon_common::service::server::server_service_error::KillServerError as DaemonKillServerError;

        auth.require::<_, _, KillServerError>(server_id, ServerPermissions::POWER)?;
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

    #[route("/{server_id}/variables", method = GET)]
    #[error(auth::{permission_denied, unreachable}, template::{corrupted, unavailable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn server_variables(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<VariablePayload, _> {
        auth.require::<_, _, ServerVariablesError>(server_id, ServerPermissions::BUILD_VIEW)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerVariablesError::ServerNotFound)?;

        server
            .template
            .extra_to_variables(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<ServerVariablesError>)
    }

    #[route("/{server_id}/variables", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, template::{corrupted, unavailable, input_invalid}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
    async fn update_variables(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        variables: HashMap<String, String>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateVariablesError>(server_id, ServerPermissions::BUILD_EDIT)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateVariablesError::ServerNotFound)?;

        let new_extra = server
            .template
            .variables_to_extra_validated(
                self.cache.clone(),
                server.template_extra.clone(),
                variables,
            )
            .await
            .map_err(TemplateError::into::<UpdateVariablesError>)?;

        let new_build = server
            .template
            .extra_to_build_payload(
                self.cache.clone(),
                new_extra.ok_or(UpdateVariablesError::TemplateInputInvalid)?,
            )
            .await
            .map_err(TemplateError::into::<UpdateVariablesError>)?;

        server
            .node
            .update_server(server.node_server_id, None, Some(new_build), None, None)
            .await
            .map_err(|err| {
                error!("Failed to update server variables: {err:?}");
                UpdateVariablesError::NodeFailure
            })?;

        Ok(())
    }
}
