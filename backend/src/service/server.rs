use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use crate::db::license::ServerLicenseInfo;
use crate::db::project::ProjectId;
use crate::db::server::ports::{NetworkPort, NetworkProtocol, ServerPort};
use crate::db::server::resync::is_running_label;
use crate::db::server::{ServerCustomization, ServerId};
use crate::service::server::server_service_error::{
    AcceptServerLicenseError, KillServerError, RestartServerError, ServerInfoError,
    ServerLicensesError, ServerStartupError, ServerStatsError, ServerTerminalError,
    ServerVariablesError, StartServerError, StopServerError, UpdateServerError, UpdateStartupError,
    UpdateVariablesError, WipeServerError,
};
use crate::service::template::*;
use crate::templates::variable::VariablePayload;
use crate::templates::{ENV_FILE_ENVIRONMENT, STARTUP_COMMAND_ENVIRONMENT, TemplateError};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use daemon_common::service::backup::backup_service_error::{
    ServerCreateBackupOrderError, ServerListBackupsError,
};
use daemon_common::service::files::files_service_error::WipeServerError as DaemonWipeServerError;
use daemon_common::service::server::{ServerNetworkPayload, ServerResourcePayload, ServerStats};
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query};
use tracing::{error, warn};
use uuid::Uuid;
use zelus::{define_query_variable, service};

define_query_variable!(project "The project");
define_query_variable!(node "The node");
define_query_variable!(template "The template");
define_query_variable!(include "Whether to include live status from the daemon");
define_query_variable!(cols "The number of columns for the terminal");
define_query_variable!(rows "The number of rows for the terminal");

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerListInfo {
    id: ServerId,
    name: String,
    project: ProjectId,
    project_name: String,
    project_slug: String,
    template: String,
    node: String,
    node_id: Uuid,

    status: Option<ServerListStatus>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerListStatus {
    state: String,
    started_at: Option<i64>,
    stats: ServerStats,
}

struct ServerListRecord {
    id: ServerId,
    name: String,
    project: ProjectId,
    project_name: String,
    project_slug: String,
    template: String,
    node: Uuid,
    node_server_id: i32,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct LightNodeInfo {
    pub(crate) id: Uuid,
    pub(crate) display: String,
    pub(crate) maintenance: bool,
    pub(crate) host: String,
    pub(crate) ssh_host: Option<String>,
    pub(crate) ssh_port: Option<u16>,
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
    pub(crate) features: HashSet<&'static str>,
    pub(crate) internet_access: bool,
    pub(crate) suspended: bool,
    pub(crate) suspension_reason: Option<String>,
    pub(crate) primary_port: Option<PrimaryPortInfo>,
    pub(crate) custom_dockerfile: Option<String>,

    pub(crate) stats: Option<ServerStats>,
    pub(crate) state: Option<String>,
    pub(crate) started_at: Option<i64>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerNetworkInfo {
    pub(crate) ports: Vec<NetworkPort>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerLimits {
    pub(crate) backup: Option<u32>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerStartupInfo {
    pub(crate) command: ServerStartupCommandInfo,
    pub(crate) environment: ServerStartupEnvironmentInfo,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerStartupCommandInfo {
    pub(crate) supported: bool,
    pub(crate) customized: bool,
    pub(crate) current: String,
    pub(crate) default: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ServerStartupEnvironmentInfo {
    pub(crate) supported: bool,
    pub(crate) file_enabled: bool,
    pub(crate) variables: HashMap<String, String>,
    pub(crate) reserved: HashSet<String>,
    pub(crate) file_path: String,
}

const MAX_STARTUP_COMMAND_LENGTH: usize = 4000;
const MAX_ENVIRONMENT_VARIABLES: usize = 64;
const MAX_ENVIRONMENT_KEY_LENGTH: usize = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH: usize = 4096;
const MAX_ENV_FILE_PATH_LENGTH: usize = 255;

#[service(path = "/server", tag = "server", no_sdk)]
pub(crate) impl ServerService for Backend {
    /// Lists all servers you have access to.
    ///
    /// Only servers in which you have the [`ProjectPermissions::VIEW`] permission are listed.
    #[route("", method = GET, raw, query = [project, node, template, include])]
    #[error(auth::unreachable, db::failure <- [sql:*])]
    async fn list_servers(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
        project: Option<ProjectId>,
        node: Option<Uuid>,
        template: Option<String>,
        include: Option<bool>,
    ) -> Result<Paged<ServerListInfo>, _> {
        let servers = if let Some(project) = project {
            sqlx::query_as!(
                ServerListRecord,
                r#"SELECT servers.id AS "id: ServerId", servers.name, servers.project AS "project: ProjectId",
                          projects.name AS project_name, projects.slug AS project_slug,
                          servers.node, servers.node_server_id, servers.template
                   FROM servers
                   JOIN projects ON projects.id = servers.project
                   WHERE servers.project = $1"#,
                &project
            )
            .fetch_all(&*self.database)
            .await?
        } else {
            sqlx::query_as!(
                ServerListRecord,
                r#"SELECT servers.id AS "id: ServerId", servers.name, servers.project AS "project: ProjectId",
                          projects.name AS project_name, projects.slug AS project_slug,
                          servers.node, servers.node_server_id, servers.template
                   FROM servers
                   JOIN projects ON projects.id = servers.project"#
            )
            .fetch_all(&*self.database)
            .await?
        };

        let servers = servers
            .into_iter()
            .filter(|server| node.as_ref().is_none_or(|node| server.node == *node))
            .filter(|server| {
                template
                    .as_ref()
                    .is_none_or(|template| server.template == *template)
            })
            .filter(|server| auth.has(server.id, ProjectPermissions::VIEW))
            .apply_pagesplit(&mut page)
            .collect::<Vec<_>>();

        let nodes = self.nodes.read().await;

        let templates = self.templates.read().await;

        let mut statuses: HashMap<ServerId, ServerListStatus> = if include == Some(true) {
            futures::future::join_all(servers.iter().filter_map(|server| {
                nodes.get(&server.node).map(|node| {
                    let node = Arc::clone(node);
                    let id = server.id;
                    let node_server_id = server.node_server_id.cast_unsigned();
                    async move {
                        node.server_status(node_server_id).await.ok().map(|state| {
                            (
                                id,
                                ServerListStatus {
                                    state: state.state.label,
                                    started_at: state.state.time,
                                    stats: state.stats,
                                },
                            )
                        })
                    }
                })
            }))
            .await
            .into_iter()
            .flatten()
            .collect()
        } else {
            HashMap::new()
        };

        Ok(servers
            .into_iter()
            .map(|server| ServerListInfo {
                id: server.id,
                name: server.name,
                project: server.project,
                project_name: server.project_name,
                project_slug: server.project_slug,
                node_id: server.node,
                status: statuses.remove(&server.id),
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
    #[error(auth::{permission_denied, unreachable}, template::{corrupted, unavailable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found, node::failure)]
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
                http,
                lower(external_port) AS "external_port_start!",
                upper(external_port) - 1 AS "external_port_end!"
            FROM server_ports WHERE server = $1"#,
            &server_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|record| {
            (
                record.id.cast_unsigned(),
                ServerPort {
                    host: record.host,
                    http: record.http,
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
                    http: port.http,
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
                        http: port.http,
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

        let (state, started_at, stats) =
            match server.node.server_status(server.node_server_id).await.ok() {
                Some(status) => (
                    Some(status.state.label),
                    status.state.time,
                    Some(status.stats),
                ),
                None => (None, None, None),
            };

        Ok(ServerInfo {
            id: server.id,
            name: server.name,
            project: server.project,
            cpu: server.cpu,
            ram: server.ram,
            swap: server.swap,
            disk: server.disk,
            network,
            stats,
            state,
            started_at,
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
                host: server.node.default_host.clone(),
                ssh_host: server.node.ssh_host.clone(),
                ssh_port: server.node.ssh_port,
            },
            suspended: server.suspended,
            suspension_reason: server.suspension_reason.clone(),
            custom_dockerfile: server
                .custom_dockerfile
                .clone()
                .filter(|_| auth.has((), ManagementPermissions::SERVER_MANAGE)),
        })
    }

    /// Updates server metadata and runtime limits.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`].
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`] to rename a server.
    /// Requires [`ManagementPermissions::SERVER_MANAGE`] to update resources, internet access,
    /// backup limits or custom dockerfile.
    /// Requires [`ManagementPermissions::SERVER_SUSPEND`] to (un)suspend a server or to change
    /// the reason a server is suspended for.
    #[route("/{server_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, suspension_reason_required, not_suspended}, node::failure, template::{corrupted, unavailable})]
    async fn update_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        name: Option<String>,
        resource: Option<ServerResourcePayload>,
        custom_dockerfile: Option<String>,
        suspended: Option<bool>,
        suspension_reason: Option<String>,
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

        if suspended.is_some() || suspension_reason.is_some() {
            auth.require::<_, _, UpdateServerError>((), ManagementPermissions::SERVER_SUSPEND)?;
        }

        let suspension_reason = suspension_reason.map(|reason| reason.trim().to_owned());

        if suspended == Some(true) && suspension_reason.as_ref().is_none_or(String::is_empty) {
            return Err(UpdateServerError::ServerSuspensionReasonRequired);
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

        if suspended.is_none()
            && let Some(reason) = suspension_reason.as_ref()
        {
            if !server.suspended {
                return Err(UpdateServerError::ServerNotSuspended);
            }
            if reason.is_empty() {
                return Err(UpdateServerError::ServerSuspensionReasonRequired);
            }
        }

        let new_build = if let Some(dockerfile) = &custom_dockerfile {
            let mut build = server
                .template
                .extra_to_build_payload(self.cache.clone(), server.template_extra.clone())
                .await
                .map_err(TemplateError::into::<UpdateServerError>)?;

            build
                .environment
                .extend(self.port_environment(&*self.database, server_id).await?);

            Some(
                ServerCustomization {
                    dockerfile: dockerfile.as_deref(),
                    ..server.customization()
                }
                .apply(build),
            )
        } else {
            None
        };

        if resource.is_some() || internet_access.is_some() || new_build.is_some() {
            server
                .node
                .update_server(
                    server.node_server_id,
                    resource.clone(),
                    new_build,
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
                        &server_id
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to update server (name): {err:?}"))?;
                }

                if let Some(custom_dockerfile) = custom_dockerfile {
               		query!("UPDATE servers SET custom_dockerfile = $1 WHERE id = $2", custom_dockerfile, &server_id)
                 		.execute(&mut **tx)
                  		.await
                   		.inspect_err(|err| {
                    		error!("Failed to update server (custom_dockerfile): {err:?}");
                    	})?;
                }

                match (suspended, suspension_reason) {
                    (Some(suspended), reason) => {
                        query!(
                            "UPDATE servers SET suspended = $1, suspension_reason = $2 WHERE id = $3",
                            suspended,
                            suspended.then_some(reason).flatten(),
                            &server_id
                        )
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| {
                            error!("Failed to update server (suspended): {err:?}");
                        })?;
                    }
                    (None, Some(reason)) => {
                        query!(
                            "UPDATE servers SET suspension_reason = $1 WHERE id = $2",
                            reason,
                            &server_id
                        )
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| {
                            error!("Failed to update server (suspension_reason): {err:?}");
                        })?;
                    }
                    (None, None) => {}
                }

                if let Some(internet_access) = internet_access {
                    query!(
                        "UPDATE servers SET internet_access = $1 WHERE id = $2",
                        internet_access,
                        &server_id
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
                        &server_id
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| {
                        error!("Failed to update server (backup_limit): {err:?}");
                    })?;
                }

                if let Some(resource) = resource {
                    query!(
                        "UPDATE servers SET cpu = $1, ram = $2, swap = $3, disk = $4 WHERE id = $5",
                        resource.cpu,
                        resource.ram.map(u32::cast_signed),
                        resource.swap.map(u32::cast_signed),
                        resource.disk.map(u64::cast_signed),
                        &server_id
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| {
                        error!("Failed to update server (resource): {err:?}");
                    })?;
                }

                Ok::<(), UpdateServerError>(())
            })
        })
        .await?;

        if suspended == Some(true) {
            let node = Arc::clone(&server.node);
            let node_server_id = server.node_server_id;
            let _ = tokio::task::spawn(async move { node.stop_server(node_server_id).await }).await;
        }

        Ok(())
    }

    /// Redirects to an websocket url with terminal access
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::TERMINAL_READ`].
    /// Grants Write Permissions, if [`ServerPermissions::TERMINAL_WRITE`] is present.
    #[route("/{server_id}/terminal", method = GET, query = [cols, rows])]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn server_terminal(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        cols: Option<u16>,
        rows: Option<u16>,
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
                cols,
                rows,
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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, license::not_accepted, node::failure)]
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

        if !self
            .license_pending(server_id, server.template.licenses())
            .await?
            .is_empty()
        {
            return Err(StartServerError::LicenseNotAccepted);
        }

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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, license::not_accepted, node::failure)]
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

        if !self
            .license_pending(server_id, server.template.licenses())
            .await?
            .is_empty()
        {
            return Err(RestartServerError::LicenseNotAccepted);
        }

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

    /// Deletes every file of the server.
    ///
    /// The files are gone for good — `backup` takes a full backup first, and the
    /// wipe is abandoned if that backup fails, so the files are never dropped
    /// without the backup that was asked for. The next start recreates the
    /// template's files from scratch. Refused while the server is running.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::FILES_WRITE`], and
    /// [`ServerPermissions::BACKUP_CREATE`] plus a free backup slot to take a
    /// backup.
    #[route("/{server_id}/wipe", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*],
        server::{not_found, unavailable}, node::failure, file::storage_unavailable,
        backup::{storage_unavailable, no_suitable_storage_found, limit_exceeded})]
    async fn wipe_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        backup: Option<bool>,
    ) -> Result<(), _> {
        auth.require::<_, _, WipeServerError>(server_id, ServerPermissions::FILES_WRITE)?;

        let backup = backup.unwrap_or_default();
        if backup {
            auth.require::<_, _, WipeServerError>(server_id, ServerPermissions::BACKUP_CREATE)?;
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(WipeServerError::ServerNotFound)?;

        if server
            .node
            .server_status(server.node_server_id)
            .await
            .is_ok_and(|status| is_running_label(&status.state.label))
        {
            return Err(WipeServerError::ServerUnavailable);
        }

        if backup {
            if !auth.has((), ManagementPermissions::LIMITS_BYPASS)
                && let Some(limit) = server.backup_limit
            {
                let used = server
                    .node
                    .server_list_backups(server.node_server_id)
                    .await
                    .map_err(|err| match err {
                        ServerListBackupsError::StorageMutexLocked => {
                            WipeServerError::BackupStorageUnavailable
                        }
                        err @ (ServerListBackupsError::Communication(_)
                        | ServerListBackupsError::AuthInvalid
                        | ServerListBackupsError::StorageNotFound
                        | ServerListBackupsError::SqlFailure
                        | ServerListBackupsError::StorageFailure) => {
                            error!("Failed to list backups of server {server_id}: {err:?}");
                            WipeServerError::NodeFailure
                        }
                    })?
                    .len();

                if used as u64 >= u64::from(limit) {
                    return Err(WipeServerError::BackupLimitExceeded);
                }
            }

            server
                .node
                .server_create_backup_order(server.node_server_id)
                .await
                .map_err(|err| match err {
                    ServerCreateBackupOrderError::StorageMutexLocked => {
                        WipeServerError::BackupStorageUnavailable
                    }
                    ServerCreateBackupOrderError::BackupStorageNoSuitableFound => {
                        WipeServerError::BackupNoSuitableStorageFound
                    }
                    err @ (ServerCreateBackupOrderError::Communication(_)
                    | ServerCreateBackupOrderError::AuthInvalid
                    | ServerCreateBackupOrderError::StorageNotFound
                    | ServerCreateBackupOrderError::SqlFailure
                    | ServerCreateBackupOrderError::StorageFailure) => {
                        error!("Failed to back up server {server_id} before wipe: {err:?}");
                        WipeServerError::NodeFailure
                    }
                })?;
        }

        server
            .node
            .wipe_server(server.node_server_id)
            .await
            .map_err(|err| match err {
                DaemonWipeServerError::StorageMutexLocked => {
                    WipeServerError::FileStorageUnavailable
                }
                err @ (DaemonWipeServerError::Communication(_)
                | DaemonWipeServerError::AuthInvalid
                | DaemonWipeServerError::StorageNotFound
                | DaemonWipeServerError::StorageFailure
                | DaemonWipeServerError::SqlFailure) => {
                    error!("Failed to wipe server {server_id}: {err:?}");
                    WipeServerError::NodeFailure
                }
            })
    }

    /// Gets the server's template-defined build variables.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BUILD_VIEW`].
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

    /// Updates the server's template-defined build variables and pushes the resulting build to its node.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BUILD_EDIT`].
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

        let mut new_build = server
            .template
            .extra_to_build_payload(
                self.cache.clone(),
                new_extra
                    .clone()
                    .ok_or(UpdateVariablesError::TemplateInputInvalid)?,
            )
            .await
            .map_err(TemplateError::into::<UpdateVariablesError>)?;

        new_build
            .environment
            .extend(self.port_environment(&*self.database, server_id).await?);

        let new_build = server.customization().apply(new_build);

        server
            .node
            .update_server(server.node_server_id, None, Some(new_build), None, None)
            .await
            .map_err(|err| {
                error!("Failed to update server variables: {err:?}");
                UpdateVariablesError::NodeFailure
            })?;

        query!(
            "UPDATE servers SET template_extra = $1 WHERE id = $2",
            new_extra,
            &server_id
        )
        .execute(&*self.database)
        .await
        .inspect_err(|err| error!("Failed to update server variables (template_extra): {err:?}"))?;

        Ok(())
    }

    /// Gets the server's startup command and its custom environment variables.
    ///
    /// `command` is what the server runs today, `default_command` what its template defines.
    /// `reserved_environment` lists the names the template and the port allocation own, which
    /// a custom variable cannot take over. When `env_file_enabled` is set, the server sources
    /// `env_file_path` from its working directory right before the startup command runs; the file
    /// can only introduce new names, entries for variables that are already set are ignored.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BUILD_VIEW`].
    #[route("/{server_id}/startup", method = GET)]
    #[error(auth::{permission_denied, unreachable}, template::{corrupted, unavailable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::not_found)]
    async fn server_startup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<ServerStartupInfo, _> {
        auth.require::<_, _, ServerStartupError>(server_id, ServerPermissions::BUILD_VIEW)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerStartupError::ServerNotFound)?;

        let mut build = server
            .template
            .extra_to_build_payload(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<ServerStartupError>)?;

        build
            .environment
            .extend(self.port_environment(&*self.database, server_id).await?);

        let default_command = build
            .environment
            .get(STARTUP_COMMAND_ENVIRONMENT)
            .cloned()
            .unwrap_or_default();

        Ok(ServerStartupInfo {
            command: ServerStartupCommandInfo {
                supported: server.template.supports_custom_startup(),
                customized: server.custom_startup.is_some(),
                current: server
                    .custom_startup
                    .clone()
                    .unwrap_or_else(|| default_command.clone()),
                default: default_command,
            },
            environment: ServerStartupEnvironmentInfo {
                supported: server.template.supports_custom_environment(),
                file_enabled: server.env_file_enabled,
                variables: server.custom_environment.clone(),
                reserved: build
                    .environment
                    .into_keys()
                    .chain([ENV_FILE_ENVIRONMENT.to_owned()])
                    .collect(),
                file_path: server.env_file_path.clone(),
            },
        })
    }

    /// Updates the server's startup command and its custom environment variables, then pushes
    /// the resulting build to its node.
    ///
    /// An empty `command` resets the server to the startup command of its template. Omitting a
    /// field leaves it untouched, while `environment` replaces the whole set of custom variables.
    /// `env_file_path` must be a relative path inside the server directory; it is only sourced
    /// while `env_file_enabled` is set, and a missing file is skipped rather than failing the start.
    /// The variables the build already defines are restored after the file is sourced, so the file
    /// cannot override the template's, the ports' or the custom variables.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::BUILD_EDIT`].
    #[route("/{server_id}/startup", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, template::{corrupted, unavailable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, startup_unsupported, startup_invalid, environment_unsupported, environment_invalid, env_file_invalid}, node::failure)]
    async fn update_startup(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        command: Option<String>,
        environment: Option<HashMap<String, String>>,
        env_file_enabled: Option<bool>,
        env_file_path: Option<String>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateStartupError>(server_id, ServerPermissions::BUILD_EDIT)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateStartupError::ServerNotFound)?;

        if command.is_some() && !server.template.supports_custom_startup() {
            return Err(UpdateStartupError::ServerStartupUnsupported);
        }

        if (environment.is_some() || env_file_enabled.is_some() || env_file_path.is_some())
            && !server.template.supports_custom_environment()
        {
            return Err(UpdateStartupError::ServerEnvironmentUnsupported);
        }

        let env_file_path = env_file_path
            .map(|path| {
                let path = path.trim().to_owned();
                if env_file_path_valid(&path) {
                    Ok(path)
                } else {
                    Err(UpdateStartupError::ServerEnvFileInvalid)
                }
            })
            .transpose()?;

        let command = command
            .map(|command| {
                let command = command.trim().to_owned();
                if command.is_empty() {
                    return Ok(None);
                }
                if !text_value_valid(&command, MAX_STARTUP_COMMAND_LENGTH) {
                    return Err(UpdateStartupError::ServerStartupInvalid);
                }
                Ok(Some(command))
            })
            .transpose()?;

        let mut build = server
            .template
            .extra_to_build_payload(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<UpdateStartupError>)?;

        build
            .environment
            .extend(self.port_environment(&*self.database, server_id).await?);

        if let Some(environment) = environment.as_ref() {
            if environment.len() > MAX_ENVIRONMENT_VARIABLES {
                return Err(UpdateStartupError::ServerEnvironmentInvalid);
            }

            for (key, value) in environment {
                if !environment_key_valid(key)
                    || key == ENV_FILE_ENVIRONMENT
                    || build.environment.contains_key(key)
                    || !text_value_valid(value, MAX_ENVIRONMENT_VALUE_LENGTH)
                {
                    return Err(UpdateStartupError::ServerEnvironmentInvalid);
                }
            }
        }

        let startup = match command {
            Some(ref command) => command.as_deref(),
            None => server.custom_startup.as_deref(),
        };
        let variables = environment.as_ref().unwrap_or(&server.custom_environment);
        let env_file_enabled = env_file_enabled.unwrap_or(server.env_file_enabled);
        let env_file_path = env_file_path.as_ref().unwrap_or(&server.env_file_path);

        let build = ServerCustomization {
            startup,
            environment: variables,
            env_file: env_file_enabled.then_some(env_file_path.as_str()),
            ..server.customization()
        }
        .apply(build);

        server
            .node
            .update_server(server.node_server_id, None, Some(build), None, None)
            .await
            .map_err(|err| {
                error!("Failed to update the startup of server {server_id}: {err:?}");
                UpdateStartupError::NodeFailure
            })?;

        query!(
            "UPDATE servers SET custom_startup = $1, custom_environment = $2,
                    env_file_enabled = $3, env_file_path = $4
             WHERE id = $5",
            startup,
            serde_json::to_value(variables).expect("environment variables are serializable"),
            env_file_enabled,
            env_file_path,
            &server_id
        )
        .execute(&*self.database)
        .await
        .inspect_err(|err| error!("Failed to update server startup: {err:?}"))?;

        Ok(())
    }

    /// Lists the licenses the server's template requires, together with their acceptance state.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`].
    #[route("/{server_id}/licenses", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found)]
    async fn server_licenses(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Vec<ServerLicenseInfo>, _> {
        auth.require::<_, _, ServerLicensesError>(server_id, ProjectPermissions::VIEW)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ServerLicensesError::ServerNotFound)?;

        Ok(self
            .license_states(server_id, server.template.licenses())
            .await?)
    }

    /// Accepts a license required by the server's template on behalf of the project.
    ///
    /// Until every required license is accepted, the server cannot be started.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::POWER`].
    #[route("/{server_id}/licenses/{license_id}", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::not_found, license::not_found)]
    async fn accept_server_license(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        license_id: String,
    ) -> Result<(), _> {
        auth.require::<_, _, AcceptServerLicenseError>(server_id, ServerPermissions::POWER)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(AcceptServerLicenseError::ServerNotFound)?;

        let license = server
            .template
            .licenses()
            .iter()
            .copied()
            .find(|license| license.id == license_id)
            .ok_or(AcceptServerLicenseError::LicenseNotFound)?;

        self.license_accept(server_id, license, auth.user_id())
            .await?;

        Ok(())
    }
}

fn environment_key_valid(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_ENVIRONMENT_KEY_LENGTH
        && key.starts_with(|character: char| character.is_ascii_alphabetic() || character == '_')
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn env_file_path_valid(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_ENV_FILE_PATH_LENGTH
        && path.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
                })
        })
}

fn text_value_valid(value: &str, limit: usize) -> bool {
    value.chars().count() <= limit
        && !value
            .chars()
            .any(|character| character.is_control() && character != '\n' && character != '\t')
}
