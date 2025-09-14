use crate::Backend;
use crate::db::server::ports::{NetworkPort, merge_ports};
use crate::db::server::{ServerId, ServerInfo};
use crate::service::admin::server::__ServerAdminService_error::CreateServerError;
use crate::service::server::*;
use crate::service::template::*;
use crate::service::*;
use daemon_common::service::server::__ServerService_error::CreateServerError as DaemonCreateServerError;
use daemon_common::service::server::{
    ServerNetworkPayload, ServerPortEntryPayload, ServerResourcePayload,
};
use daemon_framework::service;
use serde::Deserialize;
use sqlx::query;
use std::collections::HashMap;
use tracing::error;
use uuid::Uuid;

#[derive(Deserialize, utoipa::ToSchema)]
struct ServerCreate {
    name: String,
    owner: u32,
    node: Uuid,
    group: Option<String>,
    template: String,
    storage: String,
    cpu: Option<f32>,
    ram: Option<u32>,
    swap: Option<u32>,
    disk: Option<u64>,
    ports: HashMap<String, u16>,
    variables: HashMap<String, String>,

    internet_access: bool,
    pub backup_limit: Option<u32>,
}

#[service(path = "/admin/server", tag = "server-admin", no_sdk)]
pub(crate) impl ServerAdminService for Backend {
    #[route("/", method = PUT)]
    #[error(db(failure [sql:*]) server(not_found daemon_request_failed storage_not_found) node(not_found) template(not_found port_definition_missing data_incomplete))]
    #[doc = "Creates a new server"]
    async fn create_server(&self, body: ServerCreate) -> Result<ServerInfo, _> {
        let nodes = self.nodes.read().await;
        let Some(node) = nodes.get(&body.node).cloned() else {
            return Err(CreateServerError::NodeNotFound);
        };
        drop(nodes);

        let Some(template) = self.templates.read().await.get(&body.template).cloned() else {
            return Err(CreateServerError::TemplateNotFound);
        };

        let resource = ServerResourcePayload {
            cpu: body.cpu,
            ram: body.ram,
            swap: body.swap,
            disk: body.disk,
        };

        let default_extra = template
            .default_extra(self.cache.clone())
            .await
            .map_err(|_| CreateServerError::TemplateDataIncomplete)?;
        let extra = template
            .variables_to_extra_validated(self.cache.clone(), default_extra, body.variables)
            .await
            .map_err(|_| CreateServerError::TemplateDataIncomplete)?;
        let build = template
            .extra_to_build_payload(self.cache.clone(), extra.clone())
            .await
            .map_err(|_| CreateServerError::TemplateDataIncomplete)?;

        let mut ports2 = Vec::new();
        let port_definitions = template
            .default_ports()
            .await
            .map_err(|_| CreateServerError::TemplateDataIncomplete)?;
        for (port, external_port) in &body.ports {
            let definition = port_definitions
                .get(port)
                .ok_or(CreateServerError::TemplatePortDefinitionMissing)?;
            ports2.push(NetworkPort {
                internal_port: definition.internal_port,
                name: port.clone(),
                protocol: definition.protocol,
                external_port_start: *external_port,
                external_port_end: *external_port,
                host: node.default_host(),
                bind: Some(node.default_bind()),
            });
        }
        merge_ports(&mut ports2);

        let mut node_ports = Vec::with_capacity(ports2.len());
        for port in &ports2 {
            let difference = (port.internal_port as i32) - (port.external_port_start as i32);
            for p in port.external_port_start..=port.external_port_end {
                let internal = (difference + p as i32) as u16;
                node_ports.push(ServerPortEntryPayload {
                    protocol: port.protocol.to_string(),
                    internal_port: internal,
                    external_port: p,
                    external_ip: port.bind.as_ref().unwrap().clone(),
                })
            }
        }

        let new_server = node
            .create_server(
                body.storage.clone(),
                resource.clone(),
                build,
                node_ports,
                ServerNetworkPayload {
                    networks: Vec::new(),
                    internet_access: body.internet_access,
                },
            )
            .await
            .map_err(|err| match err {
                DaemonCreateServerError::Communication(_) => {
                    error!("Failed to communicate with server daemon: {:?}", err);
                    CreateServerError::ServerDaemonRequestFailed
                }
                DaemonCreateServerError::AuthInvalid
                | DaemonCreateServerError::SqlFailure
                | DaemonCreateServerError::ServerImageDifferent
                | DaemonCreateServerError::ServerImageMissingTag => {
                    error!("Failed to create server: {:?}", err);
                    CreateServerError::ServerDaemonRequestFailed
                }
                DaemonCreateServerError::StorageLocationNotFound => {
                    CreateServerError::ServerStorageNotFound
                }
            })?;

        let id = ServerId::generate();

        let mut conn = self.database.acquire().await?;

        query!("INSERT INTO `servers` (`id`,`node`,`node_server_id`,`owner`,`storage`,`cpu`,`ram`,`swap`,`disk`,`template`,`template_extra`,`name`,`group`,`internet_access`,`backup_limit`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    &id,
                    node.id,
                    &new_server,
                    body.owner,
                    body.storage,
                    resource.cpu,
                    resource.ram,
                    resource.swap,
                    resource.disk,
                    template.id(),
                    &extra,
                    &body.name,
                    &body.group,
                    body.internet_access,
                    body.backup_limit,
                ).execute(&mut *conn).await.inspect_err(|err| error!("Failed to insert server: {:?}", err))?;

        for port in &ports2 {
            query!("INSERT INTO `server_ports` (`server`,`host`,`name`,`internal_port`,`external_ip`,`external_port_start`,`external_port_end`,`protocol`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        &id, &port.host, port.name,port.internal_port, port.bind.as_ref().unwrap(), port.external_port_start, port.external_port_end, &port.protocol)
                .execute(&mut *conn)
                .await
                .inspect_err(|err| error!("Failed to insert server (ports): {:?}", err))?;
        }

        Ok(ServerInfo {
            node: node.id,
            id,
            name: body.name,
            node_server_id: new_server,
            owner: body.owner,
            template: template.id().to_owned(),
            template_extra: extra,
            custom_dockerfile: None,
            cpu: resource.cpu,
            ram: resource.ram,
            swap: resource.swap,
            disk: resource.disk,
            group: body.group,
            suspended: false,
            internet_access: body.internet_access,
            backup_limit: body.backup_limit,
        })
    }
}
