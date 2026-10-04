use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use crate::db::group::node_in_group;
use crate::db::project::ProjectId;
use crate::db::server::ports::NetworkProtocol;
use crate::db::server::provision::ServerProvision;
use crate::db::server::resync::is_running_label;
use crate::db::server::{ServerCustomization, ServerId};
use crate::service::admin::server::server_admin_service_error::{
    AddPortError, ChangeServerTemplateError, CreateServerError, DeletePortError, DeleteServerError,
    UpdatePortError,
};
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::template::*;
use crate::service::*;
use crate::templates::{TemplateError, ThinTemplateError};
use crate::utils::server::port_environment_key;
use daemon_common::service::backup::backup_service_error::{
    ServerCreateBackupOrderError, ServerListBackupsError,
};
use daemon_common::service::files::files_service_error::WipeServerError;
use daemon_common::service::server::{ServerPortEntryPayload, ServerResourcePayload};
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
    /// Creates a new server, optionally inside one of the node's resource groups.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*],
        server::{not_found, storage_not_found},
        project::not_found,
        node::{not_found, failure},
        group::not_on_node,
        port::{invalid, not_allocated},
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
        group: Option<String>,
    ) -> Result<ServerId, _> {
        if !auth.has((), ManagementPermissions::SERVER_MANAGE) {
            return Err(<CreateServerError as FromAuthPermissionDenied>::from());
        }

        let project_exists = query_scalar!(
            r#"SELECT (COUNT(*) > 0) AS "exists!" FROM projects WHERE id = $1"#,
            &project
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

        let group = group.filter(|group| !group.is_empty());
        if let Some(group) = group.as_deref()
            && !node_in_group(&*self.database, node.id, group).await?
        {
            return Err(CreateServerError::GroupNotOnNode);
        }

        let Some(template) = self.templates.read().await.get(&template).cloned() else {
            return Err(CreateServerError::TemplateNotFound);
        };

        self.provision_server(ServerProvision {
            name,
            node,
            project,
            template,
            storage,
            resource,
            ports,
            variables,
            internet_access,
            backup_limit,
            group,
        })
        .await
    }

    /// Deletes a server
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`] and [`ManagementPermissions::SERVER_DELETE`].
    #[route("/{server_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], server::{not_found, unavailable}, node::failure)]
    async fn delete_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteServerError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, DeleteServerError>((), ManagementPermissions::SERVER_DELETE)?;

        let routes = self.server_routes(server_id).await?;

        let backend = self.clone();
        let mut conn = self.database.acquire().await?;
        let result = conn.transaction(|tx| Box::pin(async move {
            use daemon_common::service::server::server_service_error::DeleteServerError as DaemonDeleteServerError;

            let Some(server) = backend.resolve_server(&mut **tx, server_id).await? else {
                return Err(DeleteServerError::ServerNotFound);
            };

            query!("DELETE FROM servers WHERE id = $1", &server_id)
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
        })).await;

        if result.is_ok() {
            self.deprovision_routes(&routes).await;
        }

        result
    }

    /// Switches a server to a different template.
    ///
    /// The new template starts from its own defaults (optionally overridden by
    /// `variables`), so nothing of the old template's configuration carries
    /// over. The regenerated build is pushed to the node right away and takes
    /// effect the next time the server starts.
    ///
    /// Existing port allocations are kept as they are: the new template's port
    /// definitions usually differ, and guessing how the old ones map onto them
    /// would silently break the server. Review the ports afterwards.
    ///
    /// `backup` takes a full backup before anything is touched, and `wipe`
    /// deletes every file on the server — a switch that keeps the old world data
    /// around rarely produces a working server. Both are refused while the
    /// server is running, and the switch is abandoned if the backup fails, so a
    /// wipe never happens without the backup that was asked for.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`] and [`ManagementPermissions::SERVER_MANAGE`].
    /// Requires [`ServerPermissions::BACKUP_CREATE`] and a free backup slot to
    /// take a backup, and [`ServerPermissions::FILES_WRITE`] to wipe.
    #[route("/{server_id}/template", method = POST)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*],
        server::{not_found, unavailable},
        node::failure,
        file::storage_unavailable,
        backup::{storage_unavailable, no_suitable_storage_found, limit_exceeded},
        template::{not_found, unavailable, corrupted, input_invalid})]
    async fn change_server_template(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        template: String,
        variables: Option<HashMap<String, String>>,
        backup: Option<bool>,
        wipe: Option<bool>,
    ) -> Result<(), _> {
        auth.require::<_, _, ChangeServerTemplateError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, ChangeServerTemplateError>((), ManagementPermissions::SERVER_MANAGE)?;

        let backup = backup.unwrap_or_default();
        let wipe = wipe.unwrap_or_default();

        if backup {
            auth.require::<_, _, ChangeServerTemplateError>(
                server_id,
                ServerPermissions::BACKUP_CREATE,
            )?;
        }
        if wipe {
            auth.require::<_, _, ChangeServerTemplateError>(
                server_id,
                ServerPermissions::FILES_WRITE,
            )?;
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ChangeServerTemplateError::ServerNotFound)?;

        let Some(template) = self.templates.read().await.get(&template).cloned() else {
            return Err(ChangeServerTemplateError::TemplateNotFound);
        };

        if (backup || wipe)
            && server
                .node
                .server_status(server.node_server_id)
                .await
                .is_ok_and(|status| is_running_label(&status.state.label))
        {
            return Err(ChangeServerTemplateError::ServerUnavailable);
        }

        let extra = template
            .default_extra(self.cache.clone())
            .await
            .map_err(ThinTemplateError::into::<ChangeServerTemplateError>)?;

        let extra = match variables {
            Some(variables) => template
                .variables_to_extra_validated(self.cache.clone(), extra, variables)
                .await
                .map_err(TemplateError::into::<ChangeServerTemplateError>)?
                .ok_or(ChangeServerTemplateError::TemplateInputInvalid)?,
            None => extra,
        };

        let mut build = template
            .extra_to_build_payload(self.cache.clone(), extra.clone())
            .await
            .map_err(TemplateError::into::<ChangeServerTemplateError>)?;

        build
            .environment
            .extend(self.port_environment(&*self.database, server_id).await?);

        let build = ServerCustomization {
            template: &*template,
            dockerfile: None,
            ..server.customization()
        }
        .apply(build);

        if backup {
            create_backup_before_switch(&server, &auth).await?;
        }

        if wipe {
            server
                .node
                .wipe_server(server.node_server_id)
                .await
                .map_err(|err| match err {
                    WipeServerError::StorageMutexLocked => {
                        ChangeServerTemplateError::FileStorageUnavailable
                    }
                    err @ (WipeServerError::Communication(_)
                    | WipeServerError::AuthInvalid
                    | WipeServerError::StorageNotFound
                    | WipeServerError::StorageFailure
                    | WipeServerError::SqlFailure) => {
                        error!("Failed to wipe server {server_id}: {err:?}");
                        ChangeServerTemplateError::NodeFailure
                    }
                })?;
        }

        server
            .node
            .update_server(server.node_server_id, None, Some(build), None, None, None)
            .await
            .map_err(|err| {
                error!("Failed to push the new template of server {server_id}: {err:?}");
                ChangeServerTemplateError::NodeFailure
            })?;

        query!(
            "UPDATE servers SET template = $1, template_extra = $2, custom_dockerfile = NULL WHERE id = $3",
            template.id(),
            &extra,
            &server_id
        )
        .execute(&*self.database)
        .await
        .inspect_err(|err| error!("Failed to store the new template: {err:?}"))?;

        Ok(())
    }

    /// Allocates a new port for the server.
    ///
    /// `http` marks the port as serving HTTP. Such a port stays a TCP port for the node,
    /// but it is the only kind of port a route (subdomain) can be created for.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`] and [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/{server_id}/ports", method = PUT, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*],
        server::{not_found, unavailable},
        node::failure,
        template::{unavailable, corrupted},
        port::{invalid, not_allocated})]
    async fn add_port(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        name: String,
        protocol: NetworkProtocol,
        internal_port: u16,
        external_port: PortRange,
        http: Option<bool>,
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

        let build = server
            .template
            .extra_to_build_payload(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<AddPortError>)?;

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
                protocol as NetworkProtocol,
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
                   AND server_ports.external_port && int4range($3, $4, '[]')"#,
                server.node.id,
                protocol as NetworkProtocol,
                i32::from(*external.start()),
                i32::from(*external.end())
            )
            .fetch_one(&mut **tx)
            .await?;

            if collision {
                return Err(AddPortError::PortInvalid);
            }

            query!(
                "INSERT INTO server_ports (server, host, name, protocol, internal_port, external_port, external_ip, http)
                 VALUES ($1, $2, $3, $4, $5, int4range($6, $7, '[]'), $8, $9)
                 RETURNING id",
                &server.id,
                server.node.default_host(),
                name,
                protocol as NetworkProtocol,
                i32::from(internal_port),
                i32::from(*external.start()),
                i32::from(*external.end()),
                server.node.default_bind(),
                http.unwrap_or(false) && protocol == NetworkProtocol::Tcp
            )
            .fetch_one(&mut **tx)
            .await?;

            let rows = query!(
                r#"SELECT name, internal_port, lower(external_port) AS "external_port_start!", upper(external_port) - 1 AS "external_port_end!", protocol AS "protocol: NetworkProtocol", external_ip
                 FROM server_ports WHERE server = $1 FOR UPDATE"#,
                &server.id
            )
            .fetch_all(&mut **tx)
            .await?;

            let mut payload = Vec::new();
            let mut build = build;

            for port_row in rows {
                build.environment.insert(
                    port_environment_key(&port_row.name),
                    port_row.internal_port.to_string(),
                );
                for ext in port_row.external_port_start..=port_row.external_port_end {
                    payload.push(ServerPortEntryPayload {
                        external_port: u16::try_from(ext).expect("database port constraints ensure a u16 value"),
                        internal_port: u16::try_from(port_row.internal_port).expect("database port constraints ensure a u16 value"),
                        protocol: port_row.protocol.to_string(),
                        external_ip: port_row.external_ip.clone(),
                    });
                }
            }
            let build = server.customization().apply(build);

            server
                .node
                .update_server(server.node_server_id, None, Some(build), Some(payload), None, None)
                .await
                .map_err(|_err| AddPortError::NodeFailure)?;

            Ok(())
        })
    })
    .await
    }

    /// Updates an existing port allocation for the server.
    ///
    /// Changing only `http` is a backend-side change and does not touch the node.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`] and [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/{server_id}/ports/{port_id}", method = POST)]
    #[error(
    auth::{permission_denied, unreachable},
    db::failure <- [sql:*],
    cache::failure <- [redis:*],
    server::{not_found},
    node::failure,
    template::{unavailable, corrupted},
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
        http: Option<bool>,
    ) -> Result<(), UpdatePortError> {
        auth.require::<_, _, UpdatePortError>(server_id, ProjectPermissions::VIEW)?;
        auth.require::<_, _, UpdatePortError>((), ManagementPermissions::SERVER_MANAGE)?;

        if name.is_none()
            && protocol.is_none()
            && internal_port.is_none()
            && external_port.is_none()
            && host.is_none()
            && bind.is_none()
        {
            let Some(http) = http else {
                return Ok(());
            };

            let updated = query!(
                r#"UPDATE server_ports SET http = $1
                   WHERE id = $2 AND server = $3 AND protocol = 'tcp'"#,
                http,
                port_id,
                &server_id,
            )
            .execute(&*self.database)
            .await?;

            if updated.rows_affected() == 0 {
                return Err(UpdatePortError::PortInvalid);
            }

            return Ok(());
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdatePortError::ServerNotFound)?;

        let build = server
            .template
            .extra_to_build_payload(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<UpdatePortError>)?;

        let mut conn = self.database.acquire().await?;

        conn.transaction(|tx| {
        Box::pin(async move {
            let current = query!(
                r#"SELECT protocol AS "protocol: NetworkProtocol", internal_port, lower(external_port) AS "external_port_start!", upper(external_port) - 1 AS "external_port_end!"
                 FROM server_ports WHERE id = $1 AND server = $2"#,
                port_id,
                &server.id
            )
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(UpdatePortError::ServerNotFound)?;

            let protocol_parsed = protocol.unwrap_or(current.protocol);

            let internal = internal_port.unwrap_or_else(|| {
                u16::try_from(current.internal_port)
                    .expect("database port constraints ensure a u16 value")
            });

            let (start, end) = external_port
                .as_ref()
                .map_or_else(
                    || {
                        (
                            u16::try_from(current.external_port_start)
                                .expect("database port constraints ensure a u16 value"),
                            u16::try_from(current.external_port_end)
                                .expect("database port constraints ensure a u16 value"),
                        )
                    },
                    |range| (range.start, range.end),
                );

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
                protocol_parsed as NetworkProtocol,
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
                   AND server_ports.external_port && int4range($4, $5, '[]')"#,
                server.node.id,
                protocol_parsed as NetworkProtocol,
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
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(http) = http {
                query!(
                    "UPDATE server_ports SET http=$1 WHERE id=$2 AND server=$3",
                    http && protocol_parsed == NetworkProtocol::Tcp,
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(protocol) = protocol {
                query!(
                    "UPDATE server_ports SET protocol=$1 WHERE id=$2 AND server=$3",
                    protocol as NetworkProtocol,
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(internal) = internal_port {
                query!(
                    "UPDATE server_ports SET internal_port=$1 WHERE id=$2 AND server=$3",
                    i32::from(internal),
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(range) = external_port.as_ref() {
                query!(
                    "UPDATE server_ports SET external_port=int4range($1, $2, '[]') WHERE id=$3 AND server=$4",
                    i32::from(range.start),
                    i32::from(range.end),
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(host) = host {
                query!(
                    "UPDATE server_ports SET host=$1 WHERE id=$2 AND server=$3",
                    host,
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            if let Some(bind) = bind {
                query!(
                    "UPDATE server_ports SET external_ip=$1 WHERE id=$2 AND server=$3",
                    bind,
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;
            }

            let rows = query!(
                r#"SELECT name, internal_port, lower(external_port) AS "external_port_start!", upper(external_port) - 1 AS "external_port_end!", protocol AS "protocol: NetworkProtocol", external_ip
                 FROM server_ports WHERE server = $1 FOR UPDATE"#,
                &server.id
            )
            .fetch_all(&mut **tx)
            .await?;

            let mut payload = Vec::new();
            let mut build = build;

            for port_row in rows {
                build.environment.insert(
                    port_environment_key(&port_row.name),
                    port_row.internal_port.to_string(),
                );
                for ext in port_row.external_port_start..=port_row.external_port_end {
                    payload.push(ServerPortEntryPayload {
                        external_port: u16::try_from(ext).expect("database port constraints ensure a u16 value"),
                        internal_port: u16::try_from(port_row.internal_port).expect("database port constraints ensure a u16 value"),
                        protocol: port_row.protocol.to_string(),
                        external_ip: port_row.external_ip.clone(),
                    });
                }
            }

            let build = server.customization().apply(build);

            server
                .node
                .update_server(server.node_server_id, None, Some(build), Some(payload), None, None)
                .await
                .map_err(|_err| UpdatePortError::NodeFailure)?;

            Ok(())
        })
    })
    .await
    }

    /// Removes a port allocation from the server.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::VIEW`] and [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/{server_id}/ports/{port_id}", method = DELETE)]
    #[error(
    auth::{permission_denied, unreachable},
    db::failure <- [sql:*],
    cache::failure <- [redis:*],
    server::{not_found},
    node::failure,
    template::{unavailable, corrupted}
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

        let build = server
            .template
            .extra_to_build_payload(self.cache.clone(), server.template_extra.clone())
            .await
            .map_err(TemplateError::into::<DeletePortError>)?;

        let routes = self.port_routes(port_id).await?;

        let mut conn = self.database.acquire().await?;

        let result = conn.transaction(|tx| {
            Box::pin(async move {
                let result = query!(
                    "DELETE FROM server_ports WHERE id=$1 AND server=$2",
                    port_id,
                    &server.id
                )
                .execute(&mut **tx)
                .await?;

                if result.rows_affected() == 0 {
                    return Err(DeletePortError::ServerNotFound);
                }

                let rows = query!(
                r#"SELECT name, internal_port, lower(external_port) AS "external_port_start!", upper(external_port) - 1 AS "external_port_end!", protocol AS "protocol: NetworkProtocol", external_ip
                 FROM server_ports WHERE server = $1 FOR UPDATE"#,
                &server.id
            )
                .fetch_all(&mut **tx)
                .await?;

                let mut payload = Vec::new();
                let mut build = build;

                for port_row in rows {
                    build.environment.insert(
                        port_environment_key(&port_row.name),
                        port_row.internal_port.to_string(),
                    );
                    for ext in port_row.external_port_start..=port_row.external_port_end {
                        payload.push(ServerPortEntryPayload {
                            external_port: u16::try_from(ext)
                                .expect("database port constraints ensure a u16 value"),
                            internal_port: u16::try_from(port_row.internal_port)
                                .expect("database port constraints ensure a u16 value"),
                            protocol: port_row.protocol.to_string(),
                            external_ip: port_row.external_ip.clone(),
                        });
                    }
                }

                let build = server.customization().apply(build);

                server
                    .node
                    .update_server(server.node_server_id, None, Some(build), Some(payload), None, None)
                    .await
                    .map_err(|_err| DeletePortError::NodeFailure)?;

                Ok(())
            })
        })
        .await;

        if result.is_ok() {
            self.deprovision_routes(&routes).await;
        }

        result
    }
}

async fn create_backup_before_switch(
    server: &crate::db::server::Server,
    auth: &Authentication,
) -> Result<(), ChangeServerTemplateError> {
    if !auth.has((), ManagementPermissions::LIMITS_BYPASS)
        && let Some(limit) = server.backup_limit
    {
        let used = server
            .node
            .server_list_backups(server.node_server_id)
            .await
            .map_err(|err| match err {
                ServerListBackupsError::StorageMutexLocked => {
                    ChangeServerTemplateError::BackupStorageUnavailable
                }
                failure @ (ServerListBackupsError::Communication(_)
                | ServerListBackupsError::AuthInvalid
                | ServerListBackupsError::StorageNotFound
                | ServerListBackupsError::SqlFailure
                | ServerListBackupsError::StorageFailure) => {
                    error!(
                        "Failed to list backups of server {}: {failure:?}",
                        server.id
                    );
                    ChangeServerTemplateError::NodeFailure
                }
            })?
            .len();

        if used as u64 >= u64::from(limit) {
            return Err(ChangeServerTemplateError::BackupLimitExceeded);
        }
    }

    server
        .node
        .server_create_backup_order(server.node_server_id, None)
        .await
        .map(|_id| ())
        .map_err(|err| match err {
            ServerCreateBackupOrderError::StorageMutexLocked => {
                ChangeServerTemplateError::BackupStorageUnavailable
            }
            ServerCreateBackupOrderError::BackupStorageNoSuitableFound => {
                ChangeServerTemplateError::BackupNoSuitableStorageFound
            }
            failure @ (ServerCreateBackupOrderError::Communication(_)
            | ServerCreateBackupOrderError::AuthInvalid
            | ServerCreateBackupOrderError::StorageNotFound
            | ServerCreateBackupOrderError::SqlFailure
            | ServerCreateBackupOrderError::StorageFailure) => {
                error!(
                    "Failed to back up server {} before switch: {failure:?}",
                    server.id
                );
                ChangeServerTemplateError::NodeFailure
            }
        })
}
