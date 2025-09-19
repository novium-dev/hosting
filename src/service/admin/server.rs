use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ServerPermissions};
use crate::db::server::ports::{NetworkPort, merge_ports};
use crate::db::server::{ServerId, ServerInfo};
use crate::service::admin::server::server_admin_service_error::{
    CreateServerError, DeleteServerError,
};
use crate::service::template::*;
use crate::service::*;
use crate::templates::TemplateError;
use daemon_common::service::server::server_service_error::CreateServerError as DaemonCreateServerError;
use daemon_common::service::server::{
    ServerNetworkPayload, ServerPortEntryPayload, ServerResourcePayload,
};
use sqlx::{Connection as _, query};
use std::collections::HashMap;
use tracing::error;
use uuid::Uuid;
use zelus::service;

#[service(path = "/admin/server", tag = "server", no_sdk)]
pub(crate) impl ServerAdminService for Backend {
    /// Creates a new server
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::SERVER_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth(permission_denied) db(failure [sql:*]) cache(failure [redis:*]) server(not_found storage_not_found) node(not_found failure) template(not_found unavailable corrupted port_definition_unknown input_invalid))]
    #[example("../examples/server.create.json")]
    async fn create_server(
        &self,
        #[special] auth: Authentication,
        name: String,
        owner: u32,
        node: Uuid,
        group: Option<String>,
        template: String,
        storage: String,
        resource: ServerResourcePayload,
        ports: HashMap<String, u16>,
        variables: HashMap<String, String>,
        internet_access: bool,
        backup_limit: Option<u32>,
    ) -> Result<ServerInfo, _> {
        auth.require::<_, CreateServerError>((), ManagementPermissions::SERVER_MANAGE)?;

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
            .map_err(TemplateError::into::<CreateServerError>)?;
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
            .map_err(TemplateError::into::<CreateServerError>)?;
        for (port, external_port) in &ports {
            let definition = port_definitions
                .get(port)
                .ok_or(CreateServerError::TemplatePortDefinitionUnknown)?;
            ports2.push(NetworkPort {
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
                query!("INSERT INTO `servers` (`id`,`node`,`node_server_id`,`owner`,`storage`,`cpu`,`ram`,`swap`,`disk`,`template`,`template_extra`,`name`,`group`,`internet_access`,`backup_limit`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        &id,
                        node.id,
                        &new_server,
                        owner,
                        storage,
                        resource.cpu,
                        resource.ram,
                        resource.swap,
                        resource.disk,
                        template.id(),
                        &extra,
                        &name,
                        &group,
                        internet_access,
                        backup_limit,
                    ).execute(&mut **tx).await.inspect_err(|err| error!("Failed to insert server: {err:?}"))?;

                for port in &ports2 {
                    query!("INSERT INTO `server_ports` (`server`,`host`,`name`,`internal_port`,`external_ip`,`external_port_start`,`external_port_end`,`protocol`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            &id, &port.host, port.name,port.internal_port, port.bind.as_deref().unwrap_or_else(|| node.default_bind()), port.external_port_start, port.external_port_end, &port.protocol)
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| error!("Failed to insert server (ports): {err:?}"))?;
                }
                Ok(ServerInfo {
                    node: node.id,
                    id,
                    name,
                    node_server_id: new_server,
                    owner,
                    template: template.id().to_owned(),
                    template_extra: extra,
                    custom_dockerfile: None,
                    cpu: resource.cpu,
                    ram: resource.ram,
                    swap: resource.swap,
                    disk: resource.disk,
                    group,
                    suspended: false,
                    internet_access,
                    backup_limit,
                })
            }))
                .await
        }).await
            .expect("Unable to execute create server task") // tokio::task::spawn only returns an error, if the task panics, so we panic again
    }

    /// Deletes a server
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::VIEW`] and [`ManagementPermissions::SERVER_MANAGE`].
    #[route("/{server_id}", method = PUT)]
    #[error(auth(permission_denied) db(failure [sql:*]) cache(failure [redis:*]) server(not_found unavailable) node(failure))]
    async fn delete_server(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<(), _> {
        auth.require::<_, DeleteServerError>(server_id, ServerPermissions::VIEW)?;
        auth.require::<_, DeleteServerError>((), ManagementPermissions::SERVER_DELETE)?;

        let backend = self.clone();
        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| Box::pin(async move {
            use daemon_common::service::server::server_service_error::DeleteServerError as DaemonDeleteServerError;

            let Some(server) = backend.resolve_server(&mut **tx, server_id).await? else {
                return Err(DeleteServerError::ServerNotFound);
            };

            query!("DELETE FROM `servers` WHERE `id` = ?", server_id)
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
}
