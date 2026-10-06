use crate::Backend;
use crate::db::group::group_path;
use crate::db::node::{BackendNode, NodePortAllocation};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::db::server::ports::{NetworkPort, NetworkProtocol, merge_ports};
use crate::service::error_node_failure::FromNodeFailure;
use crate::service::error_port_invalid::FromPortInvalid;
use crate::service::error_port_not_allocated::FromPortNotAllocated;
use crate::service::error_server_storage_not_found::FromServerStorageNotFound;
use crate::service::template::error_template_corrupted::FromTemplateCorrupted;
use crate::service::template::error_template_input_invalid::FromTemplateInputInvalid;
use crate::service::template::error_template_port_definition_unknown::FromTemplatePortDefinitionUnknown;
use crate::service::template::error_template_unavailable::FromTemplateUnavailable;
use crate::templates::{TemplateError, TemplateInner, ThinTemplateError};
use crate::utils::server::port_environment_key;
use daemon_common::service::server::server_service_error::CreateServerError as DaemonCreateServerError;
use daemon_common::service::server::{
    ServerNetworkPayload, ServerPortEntryPayload, ServerResourcePayload,
};
use redis::RedisError;
use sqlx::{Connection as _, query};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::error;

pub struct ServerProvision {
    pub name: String,
    pub node: Arc<BackendNode>,
    pub project: ProjectId,
    pub template: Arc<dyn TemplateInner + Send + Sync>,
    pub storage: String,
    pub resource: ServerResourcePayload,
    pub ports: HashMap<String, u16>,
    pub variables: HashMap<String, String>,
    pub internet_access: bool,
    pub backup_limit: Option<u32>,
    pub group: Option<i32>,
}

impl Backend {
    pub async fn provision_server<E>(&self, provision: ServerProvision) -> Result<ServerId, E>
    where
        E: From<sqlx::Error>
            + From<RedisError>
            + FromTemplateCorrupted
            + FromTemplateUnavailable
            + FromTemplatePortDefinitionUnknown
            + FromTemplateInputInvalid
            + FromPortInvalid
            + FromPortNotAllocated
            + FromServerStorageNotFound
            + FromNodeFailure
            + Send
            + 'static,
    {
        let ServerProvision {
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
        } = provision;

        let default_extra = template
            .default_extra(self.cache.clone())
            .await
            .map_err(ThinTemplateError::into::<E>)?;
        let Some(extra) = template
            .variables_to_extra_validated(self.cache.clone(), default_extra, variables)
            .await
            .map_err(TemplateError::into::<E>)?
        else {
            return Err(<E as FromTemplateInputInvalid>::from());
        };
        let mut build = template
            .extra_to_build_payload(self.cache.clone(), extra.clone())
            .await
            .map_err(TemplateError::into::<E>)?;

        let mut network_ports = Vec::new();
        let port_definitions = template
            .default_ports()
            .await
            .map_err(ThinTemplateError::into::<E>)?;
        let mut bound_externally = HashMap::new();
        for (port, external_port) in &ports {
            let definition = port_definitions
                .get(port)
                .ok_or_else(<E as FromTemplatePortDefinitionUnknown>::from)?;

            let internal_port = if definition.remappable {
                definition.internal_port
            } else {
                if *bound_externally
                    .entry(definition.internal_port)
                    .or_insert(*external_port)
                    != *external_port
                {
                    return Err(<E as FromPortInvalid>::from());
                }
                *external_port
            };

            build
                .environment
                .insert(port_environment_key(port), internal_port.to_string());

            network_ports.push(NetworkPort {
                id: 0,
                internal_port,
                name: port.clone(),
                protocol: definition.protocol,
                http: definition.http,
                external_port_start: *external_port,
                external_port_end: *external_port,
                host: node.default_host().to_owned(),
                bind: Some(node.default_bind().to_owned()),
            });
        }
        merge_ports(&mut network_ports);

        for port in &network_ports {
            if !port_range_allocated(
                &node.ports,
                port.protocol,
                port.external_port_start,
                port.external_port_end,
            ) {
                return Err(<E as FromPortNotAllocated>::from());
            }
        }

        let mut node_ports = Vec::with_capacity(network_ports.len());
        for port in &network_ports {
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

        let daemon_group = match group {
            Some(group) => {
                group_path(&*self.database, group)
                    .await?
                    .ok_or(sqlx::Error::RowNotFound)?
                    .daemon_name
            }
            None => String::new(),
        };

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
                    daemon_group,
                )
                .await
                .map_err(|daemon_err| match daemon_err {
                    err @ (DaemonCreateServerError::Communication(_)
                    | DaemonCreateServerError::AuthInvalid
                    | DaemonCreateServerError::SqlFailure
                    | DaemonCreateServerError::ServerImageDifferent
                    | DaemonCreateServerError::ServerImageMissingTag
                    | DaemonCreateServerError::GroupInvalidName) => {
                        error!("Failed to create server: {err:?}");
                        <E as FromNodeFailure>::from()
                    }
                    DaemonCreateServerError::StorageLocationNotFound => {
                        <E as FromServerStorageNotFound>::from()
                    }
                })?;

            let id = ServerId::generate();
            let created_on = Arc::clone(&node);

            let inserted = conn.transaction(|tx| Box::pin(async move {
                query!("INSERT INTO servers (id,node,node_server_id,project,storage,cpu,ram,swap,disk,template,template_extra,name,internet_access,backup_limit,group_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
                        &id, &node.id, new_server.cast_signed(), project.as_str(), &storage, resource.cpu, resource.ram.map(u32::cast_signed), resource.swap.map(u32::cast_signed), resource.disk.map(u64::cast_signed), template.id(), &extra, &name, internet_access, backup_limit.map(u32::cast_signed), group)
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to insert server: {err:?}"))?;

                for port in &network_ports {
                    query!("INSERT INTO server_ports (server,host,name,internal_port,external_ip,external_port,protocol,http) VALUES ($1, $2, $3, $4, $5, int4range($6, $7, '[]'), $8, $9)",
                            &id, &port.host, port.name, i32::from(port.internal_port), port.bind.as_deref().unwrap_or_else(|| node.default_bind()), i32::from(port.external_port_start), i32::from(port.external_port_end), port.protocol as NetworkProtocol, port.http)
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| error!("Failed to insert server (ports): {err:?}"))?;
                }
                Ok(id)
            }))
                .await;

            if inserted.is_err()
                && let Err(err) = created_on.delete_server(new_server).await
            {
                error!("Failed to remove server {new_server} from node {} after storing it failed: {err:?}", created_on.id);
            }

            inserted
        }).await
            .expect("Unable to execute create server task")
    }
}

pub(crate) fn port_range_allocated(
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
