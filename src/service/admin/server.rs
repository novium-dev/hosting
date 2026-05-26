use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions};
use crate::db::node::NodePortAllocation;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::db::server::ports::{NetworkPort, NetworkProtocol, merge_ports};
use crate::service::admin::server::server_admin_service_error::{
    AddPortError, CreateServerError, DeletePortError, DeleteServerError, UpdatePortError,
};
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::template::*;
use crate::service::*;
use crate::templates::{TemplateError, ThinTemplateError};
use daemon_common::service::server::server_service_error::CreateServerError as DaemonCreateServerError;
use daemon_common::service::server::{
    ServerNetworkPayload, ServerPortEntryPayload, ServerResourcePayload,
};
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query, query_scalar};
use std::collections::HashMap;
use tracing::error;
use uuid::Uuid;
use zelus::service;

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct PortRange {
    pub(crate) start: u16,
    pub(crate) end: u16,
}

#[service(path = "/admin/server", tag = "server", no_sdk)]
pub(crate) impl ServerAdminService for Backend {
    /// Creates a new server
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*],
        server::{not_found, storage_not_found},
        project::not_found,
        node::{not_found, failure},
        port::not_allocated,
        template::{not_found, unavailable, corrupted, port_definition_unknown, input_invalid})]
    #[example("../examples/server.create.json")]
    async fn create_server(
        &self,
        #[special] auth: Authentication,
        name: String,
        node: Uuid,
        project: ProjectId,
        template: String,
        storage: String,
        resource: ServerResourcePayload,
        ports: HashMap<String, u16>,
        variables: HashMap<String, String>,
        internet_access: bool,
        backup_limit: Option<u32>,
    ) -> Result<ServerId, _> {
        if !auth.has((), ManagementPermissions::SERVER_MANAGE) {
            return Err(<CreateServerError as FromAuthPermissionDenied>::from());
        }

        let project_exists = query_scalar!(
            r#"SELECT (COUNT(*) > 0) AS "exists!" FROM projects WHERE id = $1"#,
            project.as_str()
        )
        .fetch_one(&*self.database)
        .await?;
        if !project_exists {
            return Err(CreateServerError::ProjectNotFound);
        }

        let nodes = self.nodes.read().await;
        let Some(node) = nodes.get(&node).cloned() else {
            return Err(CreateServerError::NodeNotFound);
        };
        drop(nodes);

        let Some(template) = self.templates.read().await.get(&template).cloned() else {
            return Err(CreateServerError::TemplateNotFound);
        };

        let default_extra = template
            .default_extra(self.cache.clone())
            .await
            .map_err(ThinTemplateError::into::<CreateServerError>)?;
        let Some(extra) = template
            .variables_to_extra_validated(self.cache.clone(), default_extra, variables)
            .await
            .map_err(TemplateError::into::<CreateServerError>)?
        else {
            return Err(CreateServerError::TemplateInputInvalid);
        };
        let build = template
            .extra_to_build_payload(self.cache.clone(), extra.clone())
            .await
            .map_err(TemplateError::into::<CreateServerError>)?;

        let mut ports2 = Vec::new();
        let port_definitions = template
            .default_ports()
            .await
            .map_err(ThinTemplateError::into::<CreateServerError>)?;
        for (port, external_port) in &ports {
            let definition = port_definitions
                .get(port)
                .ok_or(CreateServerError::TemplatePortDefinitionUnknown)?;
            ports2.push(NetworkPort {
                id: 0,
                internal_port: definition.internal_port,
                name: port.clone(),
                protocol: definition.protocol,
                external_port_start: *external_port,
                external_port_end: *external_port,
                host: node.default_host().to_owned(),
                bind: Some(node.default_bind().to_owned()),
            });
        }
        merge_ports(&mut ports2);

        for port in &ports2 {
            if !port_range_allocated(
                &node.ports,
                port.protocol,
                port.external_port_start,
                port.external_port_end,
            ) {
                return Err(CreateServerError::PortNotAllocated);
            }
        }

        let mut node_ports = Vec::with_capacity(ports2.len());
        for port in &ports2 {
            let difference = i32::from(port.internal_port) - i32::from(port.external_port_start);
            for port_number in port.external_port_start..=port.external_port_end {
                if let Ok(internal) = u16::try_from(difference + i32::from(port_number)) {
                    node_ports.push(ServerPortEntryPayload {
                        protocol: port.protocol.to_string(),
                        internal_port: internal,
                        external_port: port_number,
                        external_ip: port
                            .bind
                            .as_deref()
                            .unwrap_or_else(|| node.default_bind())
                            .to_owned(),
                    });
                }
            }
        }

        let mut conn = self.database.acquire().await?;
        tokio::task::spawn(async move {
            let new_server = node
                .create_server(
                    storage.clone(),
                    resource.clone(),
                    build,
                    node_ports,
                    ServerNetworkPayload {
                        networks: Vec::new(),
                        internet_access,
                    },
                )
                .await
                .map_err(|err| match err {
                    err @ (DaemonCreateServerError::Communication(_)
                    | DaemonCreateServerError::AuthInvalid
                    | DaemonCreateServerError::SqlFailure
                    | DaemonCreateServerError::ServerImageDifferent
                    | DaemonCreateServerError::ServerImageMissingTag) => {
                        error!("Failed to create server: {err:?}");
                        CreateServerError::NodeFailure
                    }
                    DaemonCreateServerError::StorageLocationNotFound => {
                        CreateServerError::ServerStorageNotFound
                    }
                })?;

            let id = ServerId::generate();

            conn.transaction(|tx| Box::pin(async move {
                query!("INSERT INTO servers (id,node,node_server_id,project,storage,cpu,ram,swap,disk,template,template_extra,name,internet_access,backup_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
                        id.as_str(), &node.id, new_server as i32, project.as_str(), &storage, resource.cpu, resource.ram.map(|value| value as i32), resource.swap.map(|value| value as i32), resource.disk.map(|value| value as i64), template.id(), &extra, &name, internet_access, backup_limit.map(|value| value as i32))                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to insert server: {err:?}"))?;

                for port in &ports2 {
                    query!("INSERT INTO server_ports (server,host,name,internal_port,external_ip,external_port_start,external_port_end,protocol) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                            id.as_str(), &port.host, port.name, i32::from(port.internal_port), port.bind.as_deref().unwrap_or_else(|| node.default_bind()), i32::from(port.external_port_start), i32::from(port.external_port_end), port.protocol.to_string())
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| error!("Failed to insert server (ports): {err:?}"))?;
                }
                Ok(id)
            }))
                .await
        }).await
            .expect("Unable to execute create server task") // tokio::task::spawn only returns an error, if the task panics, so we panic again
    }

    /// Deletes a server
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`] and [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/{server_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::{not_found, unavailable}, node::failure)]
    async fn delete_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteServerError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, DeleteServerError>((), ManagementPermissions::SERVER_DELETE)?;

        let backend = self.clone();
        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| Box::pin(async move {
            use daemon_common::service::server::server_service_error::DeleteServerError as DaemonDeleteServerError;

            let Some(server) = backend.resolve_server(&mut **tx, server_id).await? else {
                return Err(DeleteServerError::ServerNotFound);
            };

            query!("DELETE FROM servers WHERE id = $1", server_id.as_str())
                .execute(&mut **tx)
                .await
                .inspect_err(|err| error!("Failed to delete server: {err:?}"))?;

            match tokio::task::spawn(async move { server.node.delete_server(server.node_server_id).await }).await
                .expect("server deletion task failed") {
                Ok(()) | Err(DaemonDeleteServerError::ServerNotFound) => Ok(()),
                Err(DaemonDeleteServerError::ServerMutexLocked) => {
                    Err(DeleteServerError::ServerUnavailable)
                },
                Err(err @ (DaemonDeleteServerError::Communication(_)
                    | DaemonDeleteServerError::AuthInvalid
                    | DaemonDeleteServerError::DockerFailure
                    | DaemonDeleteServerError::SqlFailure)) => {
                    error!("Failed to delete server: {err:?}");
                    Err(DeleteServerError::NodeFailure)
                },
            }
        })).await
    }

    #[route("/{server_id}/ports", method = PUT, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*],
        server::{not_found, unavailable},
        node::failure,
        port::{invalid, not_allocated})]
    async fn add_port(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        name: String,
        protocol: NetworkProtocol,
        internal_port: u16,
        external_port: PortRange,
    ) -> Result<(), _> {
        if external_port.start > external_port.end {
            return Err(AddPortError::PortInvalid);
        }

        let external = external_port.start..=external_port.end;

        if (u32::from(internal_port) + u32::from(external.end() - external.start()))
            > u32::from(u16::MAX)
        {
            return Err(AddPortError::PortInvalid);
        }

        auth.require::<_, _, AddPortError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, AddPortError>((), ManagementPermissions::SERVER_MANAGE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(AddPortError::ServerNotFound)?;

        let mut conn = self.database.acquire().await?;

        conn.transaction(|tx| {
        Box::pin(async move {
            let allocated = query_scalar!(
                r#"SELECT (COUNT(*) > 0) as "exists!"
                   FROM node_ports
                   WHERE node = $1
                   AND protocol = $2
                   AND start <= $3
                   AND "end" >= $4"#,
                server.node.id,
                protocol.to_string(),
                i32::from(*external.start()),
                i32::from(*external.end())
            )
            .fetch_one(&mut **tx)
            .await?;

            if !allocated {
                return Err(AddPortError::PortNotAllocated);
            }

            let collision = query_scalar!(
                r#"SELECT (COUNT(*) > 0) as "exists!"
                   FROM server_ports
                   JOIN servers ON server_ports.server = servers.id
                   WHERE servers.node = $1
                   AND server_ports.protocol = $2
                   AND $3 <= external_port_end
                   AND $4 >= external_port_start"#,
                server.node.id,
                protocol.to_string(),
                i32::from(*external.start()),
                i32::from(*external.end())
            )
            .fetch_one(&mut **tx)
            .await?;

            if collision {
                return Err(AddPortError::PortInvalid);
            }

            query!(
                "INSERT INTO server_ports (server, host, name, protocol, internal_port, external_port_start, external_port_end, external_ip)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id",
                server.id.as_str(),
                server.node.default_host(),
                name,
                protocol.to_string(),
                i32::from(internal_port),
                i32::from(*external.start()),
                i32::from(*external.end()),
                server.node.default_bind()
            )
            .fetch_one(&mut **tx)
            .await?
            .id as u32;


            let rows = query!(
                "SELECT internal_port, external_port_start, external_port_end, protocol, external_ip
                 FROM server_ports WHERE server = $1 FOR UPDATE",
                server.id.as_str()
            )
            .fetch_all(&mut **tx)
            .await?;

            let mut payload = Vec::new();

            for port_row in rows {
                for ext in port_row.external_port_start..=port_row.external_port_end {
                    payload.push(ServerPortEntryPayload {
                        external_port: ext as u16,
                        internal_port: port_row.internal_port as u16,
                        protocol: port_row.protocol.clone(),
                        external_ip: port_row.external_ip.clone(),
                    });
                }
            }

            server
                .node
                .update_server(server.node_server_id, None, None, Some(payload), None)
                .await
                .map_err(|_err| AddPortError::NodeFailure)?;

            Ok(())
        })
    })
    .await
    }

    #[route("/{server_id}/ports/{port_id}", method = POST)]
    #[error(
    auth::{permission_denied, unreachable},
    db::failure <- [sql:*],
    server::{not_found},
    node::failure,
    port::{invalid, not_allocated, collision}
)]
    async fn update_port(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        port_id: i32,
        name: Option<String>,
        protocol: Option<NetworkProtocol>,
        internal_port: Option<u16>,
        external_port: Option<PortRange>,
        host: Option<String>,
        bind: Option<String>,
    ) -> Result<(), UpdatePortError> {
        auth.require::<_, _, UpdatePortError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, UpdatePortError>((), ManagementPermissions::SERVER_MANAGE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdatePortError::ServerNotFound)?;

        let mut conn = self.database.acquire().await?;

        conn.transaction(|tx| {
        Box::pin(async move {
            let current = query!(
                "SELECT protocol, internal_port, external_port_start, external_port_end
                 FROM server_ports WHERE id = $1 AND server = $2",
                port_id,
                server.id.as_str()
            )
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(UpdatePortError::ServerNotFound)?;

            let protocol_parsed = protocol
                .unwrap_or_else(|| NetworkProtocol::by_name(current.protocol.as_str()));

            let internal = internal_port.unwrap_or(current.internal_port as u16);

            let (start, end) = external_port
                .as_ref()
                .map_or((current.external_port_start as u16, current.external_port_end as u16), |range| {
                    (range.start, range.end)
                });

            if start > end {
                return Err(UpdatePortError::PortInvalid);
            }

            if (u32::from(internal) + u32::from(end - start)) > u32::from(u16::MAX) {
                return Err(UpdatePortError::PortInvalid);
            }

            let allocated = query_scalar!(
                r#"SELECT (COUNT(*) > 0) as "exists!"
                   FROM node_ports
                   WHERE node = $1
                   AND protocol = $2
                   AND start <= $3
                   AND "end" >= $4"#,
                server.node.id,
                protocol_parsed.to_string(),
                i32::from(start),
                i32::from(end)
            )
            .fetch_one(&mut **tx)
            .await?;

            if !allocated {
                return Err(UpdatePortError::PortNotAllocated);
            }

            let collision = query_scalar!(
                r#"SELECT (COUNT(*) > 0) as "exists!"
                   FROM server_ports
                   JOIN servers ON server_ports.server = servers.id
                   WHERE servers.node = $1
                   AND server_ports.protocol = $2
                   AND server_ports.id != $3
                   AND $4 <= external_port_end
                   AND $5 >= external_port_start"#,
                server.node.id,
                protocol_parsed.to_string(),
                port_id,
                i32::from(start),
                i32::from(end)
            )
            .fetch_one(&mut **tx)
            .await?;

            if collision {
                return Err(UpdatePortError::PortCollision);
            }

            if let Some(name) = name {
                query!(
                    "UPDATE server_ports SET name=$1 WHERE id=$2 AND server=$3",
                    name,
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(protocol) = protocol {
                query!(
                    "UPDATE server_ports SET protocol=$1 WHERE id=$2 AND server=$3",
                    protocol.to_string(),
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(internal) = internal_port {
                query!(
                    "UPDATE server_ports SET internal_port=$1 WHERE id=$2 AND server=$3",
                    i32::from(internal),
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(range) = external_port.as_ref() {
                query!(
                    "UPDATE server_ports SET external_port_start=$1, external_port_end=$2 WHERE id=$3 AND server=$4",
                    i32::from(range.start),
                    i32::from(range.end),
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(host) = host {
                query!(
                    "UPDATE server_ports SET host=$1 WHERE id=$2 AND server=$3",
                    host,
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(bind) = bind {
                query!(
                    "UPDATE server_ports SET external_ip=$1 WHERE id=$2 AND server=$3",
                    bind,
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;
            }

            let rows = query!(
                "SELECT internal_port, external_port_start, external_port_end, protocol, external_ip
                 FROM server_ports WHERE server = $1 FOR UPDATE",
                server.id.as_str()
            )
            .fetch_all(&mut **tx)
            .await?;

            let mut payload = Vec::new();

            for port_row in rows {
                for ext in port_row.external_port_start..=port_row.external_port_end {
                    payload.push(ServerPortEntryPayload {
                        external_port: ext as u16,
                        internal_port: port_row.internal_port as u16,
                        protocol: port_row.protocol.clone(),
                        external_ip: port_row.external_ip.clone(),
                    });
                }
            }

            server
                .node
                .update_server(server.node_server_id, None, None, Some(payload), None)
                .await
                .map_err(|_err| UpdatePortError::NodeFailure)?;

            Ok(())
        })
    })
    .await
    }

    #[route("/{server_id}/ports/{port_id}", method = DELETE)]
    #[error(
    auth::{permission_denied, unreachable},
    db::failure <- [sql:*],
    server::{not_found},
    node::failure
)]
    async fn delete_port(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        port_id: i32,
    ) -> Result<(), DeletePortError> {
        auth.require::<_, _, DeletePortError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, DeletePortError>((), ManagementPermissions::SERVER_MANAGE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DeletePortError::ServerNotFound)?;

        let mut conn = self.database.acquire().await?;

        conn.transaction(|tx| {
            Box::pin(async move {
                let result = query!(
                    "DELETE FROM server_ports WHERE id=$1 AND server=$2",
                    port_id,
                    server.id.as_str()
                )
                .execute(&mut **tx)
                .await?;

                if result.rows_affected() == 0 {
                    return Err(DeletePortError::ServerNotFound);
                }

                let rows = query!(
                "SELECT internal_port, external_port_start, external_port_end, protocol, external_ip
                 FROM server_ports WHERE server = $1 FOR UPDATE",
                server.id.as_str()
            )
                .fetch_all(&mut **tx)
                .await?;

                let mut payload = Vec::new();

                for port_row in rows {
                    for ext in port_row.external_port_start..=port_row.external_port_end {
                        payload.push(ServerPortEntryPayload {
                            external_port: ext as u16,
                            internal_port: port_row.internal_port as u16,
                            protocol: port_row.protocol.clone(),
                            external_ip: port_row.external_ip.clone(),
                        });
                    }
                }

                server
                    .node
                    .update_server(server.node_server_id, None, None, Some(payload), None)
                    .await
                    .map_err(|_err| DeletePortError::NodeFailure)?;

                Ok(())
            })
        })
        .await
    }
}

fn port_range_allocated(
    allocations: &[NodePortAllocation],
    protocol: NetworkProtocol,
    start: u16,
    end: u16,
) -> bool {
    allocations.iter().any(|allocation| {
        allocation.protocol == protocol
            && allocation.start <= i32::from(start)
            && allocation.end >= i32::from(end)
    })
}
