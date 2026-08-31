use crate::Backend;
use crate::db::node::BackendNode;
use crate::db::server::ports::NetworkProtocol;
use crate::integrity::{Check, CheckError, describe_transport};
use daemon_common::integrity::{IntegrityCategory, IntegrityFinding, IntegrityStatus};
use daemon_common::node::BackendNodeConfig;
use daemon_common::service::integrity::integrity_service_error::{
    IntegrityServersError, IntegrityStatusError,
};
use daemon_common::service::setup::setup_service_error::ConfigError;
use sqlx::query;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;
use zelus::async_trait;

async fn nodes(backend: &Backend) -> Vec<Arc<BackendNode>> {
    let mut nodes: Vec<Arc<BackendNode>> = backend.nodes.read().await.values().cloned().collect();
    nodes.sort_by(|left, right| left.display.cmp(&right.display));
    nodes
}

async fn status(node: &BackendNode) -> Result<IntegrityStatus, String> {
    node.integrity_status().await.map_err(|err| match err {
        IntegrityStatusError::Communication(inner) => describe_transport(&inner),
        other => format!("the node answered with an error: {other:?}"),
    })
}

fn subject(node: &BackendNode) -> String {
    format!("{} ({})", node.display, node.id)
}

pub(crate) struct NodesReachable;

#[async_trait]
impl Check for NodesReachable {
    fn id(&self) -> &'static str {
        "nodes.reachable"
    }

    fn title(&self) -> &'static str {
        "Nodes are reachable over mTLS"
    }

    fn description(&self) -> &'static str {
        "Every registered node must answer the backend over its mutually authenticated TLS \
         connection. The handshake pins the node's certificate to its id, so a node that answers \
         at all is also presenting the certificate this backend issued to it."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Connectivity
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let nodes = nodes(backend).await;
        if nodes.is_empty() {
            return Err(CheckError::Skipped(
                "No node is registered on this instance".to_owned(),
            ));
        }

        let mut findings = Vec::new();
        for node in nodes {
            match status(&node).await {
                Ok(status) => findings.push(
                    IntegrityFinding::info("The node answered over mTLS")
                        .with_subject(subject(&node))
                        .with_detail("version", status.version)
                        .with_detail("api", status.api_hash.clone())
                        .with_detail("uptime_seconds", status.uptime.to_string())
                        .with_detail("servers", status.server_count.to_string())
                        .with_detail("maintenance", node.maintenance.to_string()),
                ),
                Err(reason) => findings.push(
                    IntegrityFinding::error(format!("The node is not reachable: {reason}"))
                        .with_subject(subject(&node))
                        .with_detail("maintenance", node.maintenance.to_string()),
                ),
            }
        }

        Ok(findings)
    }
}

pub(crate) struct NodesVersion;

#[async_trait]
impl Check for NodesVersion {
    fn id(&self) -> &'static str {
        "nodes.version"
    }

    fn title(&self) -> &'static str {
        "Nodes were built against the same daemon API as the backend"
    }

    fn description(&self) -> &'static str {
        "Nodes are released on their own schedule, so their commit does not have to match the \
         backend's. What has to match is the API: both sides carry a fingerprint of the shared \
         OpenAPI document generated from the service definitions they were compiled from, and a \
         node whose fingerprint differs answers a different shape of the API than this backend \
         calls."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Version
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let nodes = nodes(backend).await;
        if nodes.is_empty() {
            return Err(CheckError::Skipped(
                "No node is registered on this instance".to_owned(),
            ));
        }

        let mut findings = Vec::new();
        for node in nodes {
            let Ok(status) = status(&node).await else {
                continue;
            };

            let expected = backend.daemon_api_hash();
            if status.api_hash != expected {
                findings.push(
                    IntegrityFinding::error(
                        "The node was built against different daemon service definitions than \
                         this backend; the two do not agree on the shape of the API",
                    )
                    .with_subject(subject(&node))
                    .with_detail("node_api", display_hash(&status.api_hash))
                    .with_detail("node_commit", status.version)
                    .with_detail("backend_api", expected.to_owned()),
                );
            }
        }

        Ok(findings)
    }
}

pub(crate) struct NodesConfig;

#[async_trait]
impl Check for NodesConfig {
    fn id(&self) -> &'static str {
        "nodes.config"
    }

    fn title(&self) -> &'static str {
        "Stored node config matches the running daemon"
    }

    fn description(&self) -> &'static str {
        "The backend keeps its own copy of every node's base url, ssh port and storage names. \
         When the daemon's config drifts from it, servers get placed on storages the node does \
         not have."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Configuration
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let nodes = nodes(backend).await;
        if nodes.is_empty() {
            return Err(CheckError::Skipped(
                "No node is registered on this instance".to_owned(),
            ));
        }

        let mut findings = Vec::new();
        for node in nodes {
            let live: BackendNodeConfig = match node.config().await {
                Ok(config) => config,
                Err(ConfigError::Communication(inner)) => {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The node's config could not be pulled: {}",
                            describe_transport(&inner)
                        ))
                        .with_subject(subject(&node)),
                    );
                    continue;
                }
                Err(other) => {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The node refused to hand out its config: {other:?}"
                        ))
                        .with_subject(subject(&node)),
                    );
                    continue;
                }
            };

            let stored_ssh = node.ssh_port;
            if stored_ssh != live.ssh_port {
                findings.push(
                    IntegrityFinding::warning(
                        "The stored ssh port differs from the one the node reports",
                    )
                    .with_subject(subject(&node))
                    .with_detail("stored", format_option(stored_ssh))
                    .with_detail("node", format_option(live.ssh_port)),
                );
            }

            compare_names(
                &mut findings,
                &node,
                "server storage",
                &node.server_storages,
                &live.storages,
            );
            compare_names(
                &mut findings,
                &node,
                "backup storage",
                &node.backup_storages,
                &live.backups,
            );
        }

        Ok(findings)
    }
}

fn format_option(value: Option<u16>) -> String {
    value.map_or_else(|| "none".to_owned(), |port| port.to_string())
}

fn compare_names(
    findings: &mut Vec<IntegrityFinding>,
    node: &BackendNode,
    label: &str,
    stored: &[String],
    live: &[String],
) {
    let stored: BTreeSet<&String> = stored.iter().collect();
    let live: BTreeSet<&String> = live.iter().collect();

    for name in stored.difference(&live) {
        findings.push(
            IntegrityFinding::error(format!(
                "The backend still offers the {label} {name}, but the node no longer has it"
            ))
            .with_subject(subject(node))
            .with_detail("storage", (*name).clone()),
        );
    }
    for name in live.difference(&stored) {
        findings.push(
            IntegrityFinding::warning(format!(
                "The node has the {label} {name}, but the backend does not know about it. Pull \
                 the node's config to pick it up"
            ))
            .with_subject(subject(node))
            .with_detail("storage", (*name).clone()),
        );
    }
}

pub(crate) struct NodesServers;

#[async_trait]
impl Check for NodesServers {
    fn id(&self) -> &'static str {
        "nodes.servers"
    }

    fn title(&self) -> &'static str {
        "Servers exist on both sides"
    }

    fn description(&self) -> &'static str {
        "Every server the backend places on a node must exist in that node's database, and the \
         node must not hold servers the backend has forgotten. An orphan on the node keeps its \
         storage, ports and container; a server missing on the node can never be started."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Database
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let nodes = nodes(backend).await;
        if nodes.is_empty() {
            return Err(CheckError::Skipped(
                "No node is registered on this instance".to_owned(),
            ));
        }

        let rows = query!(
            r#"SELECT id, name, node, node_server_id FROM servers ORDER BY node, node_server_id"#
        )
        .fetch_all(&*backend.database)
        .await?;

        let mut expected: HashMap<Uuid, HashMap<u32, (String, String)>> = HashMap::new();
        for row in rows {
            expected
                .entry(row.node)
                .or_default()
                .insert(row.node_server_id.cast_unsigned(), (row.id, row.name));
        }

        let mut findings = Vec::new();
        for node in nodes {
            let actual = match node.integrity_servers().await {
                Ok(servers) => servers,
                Err(IntegrityServersError::Communication(inner)) => {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The node's server list could not be pulled: {}",
                            describe_transport(&inner)
                        ))
                        .with_subject(subject(&node)),
                    );
                    continue;
                }
                Err(other) => {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The node refused to list its servers: {other:?}"
                        ))
                        .with_subject(subject(&node)),
                    );
                    continue;
                }
            };

            let actual: HashSet<u32> = actual.into_iter().collect();
            let known = expected.remove(&node.id).unwrap_or_default();

            for (node_server_id, (id, name)) in &known {
                if !actual.contains(node_server_id) {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "Server {name} is placed on this node, but the node's database does \
                             not have it"
                        ))
                        .with_subject(format!("{id} ({name})"))
                        .with_detail("node", subject(&node))
                        .with_detail("node_server_id", node_server_id.to_string()),
                    );
                }
            }

            for node_server_id in &actual {
                if !known.contains_key(node_server_id) {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The node runs server {node_server_id}, but the backend has no record \
                             of it. Its storage, ports and container are never cleaned up"
                        ))
                        .with_subject(format!("{}/{node_server_id}", node.display))
                        .with_detail("node", subject(&node))
                        .with_detail("node_server_id", node_server_id.to_string()),
                    );
                }
            }
        }

        for (node, servers) in expected {
            for (node_server_id, (id, name)) in servers {
                findings.push(
                    IntegrityFinding::error(format!(
                        "Server {name} is placed on node {node}, which is not registered on this \
                         instance"
                    ))
                    .with_subject(format!("{id} ({name})"))
                    .with_detail("node", node.to_string())
                    .with_detail("node_server_id", node_server_id.to_string()),
                );
            }
        }

        Ok(findings)
    }
}

pub(crate) struct NodesStorages;

#[async_trait]
impl Check for NodesStorages {
    fn id(&self) -> &'static str {
        "nodes.storages"
    }

    fn title(&self) -> &'static str {
        "Servers point at a storage their node has"
    }

    fn description(&self) -> &'static str {
        "A server records the name of the storage it lives on. When that name is not among the \
         storages registered for its node, every file and backup operation on it fails."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Storage
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let nodes = backend.nodes.read().await.clone();

        let rows = query!(r#"SELECT id, name, node, storage FROM servers ORDER BY id"#)
            .fetch_all(&*backend.database)
            .await?;

        let mut findings = Vec::new();
        for row in rows {
            let Some(node) = nodes.get(&row.node) else {
                continue;
            };
            if !node.server_storages.contains(&row.storage) {
                findings.push(
                    IntegrityFinding::error(format!(
                        "Server {} lives on storage {}, which node {} does not have",
                        row.name, row.storage, node.display
                    ))
                    .with_subject(format!("{} ({})", row.id, row.name))
                    .with_detail("node", subject(node))
                    .with_detail("storage", row.storage)
                    .with_detail("available", node.server_storages.join(", ")),
                );
            }
        }

        Ok(findings)
    }
}

pub(crate) struct NodesPorts;

#[async_trait]
impl Check for NodesPorts {
    fn id(&self) -> &'static str {
        "nodes.ports"
    }

    fn title(&self) -> &'static str {
        "Allocated ports stay inside their node's ranges and do not collide"
    }

    fn description(&self) -> &'static str {
        "A server port must sit inside one of the ranges allocated to its node, and two servers \
         on the same node must not share an address, protocol and port. A collision makes \
         whichever server starts second fail to bind."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Configuration
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let nodes = backend.nodes.read().await.clone();

        let rows = query!(
            r#"SELECT
                   server_ports.id,
                   server_ports.server,
                   server_ports.name,
                   server_ports.external_ip,
                   server_ports.protocol AS "protocol: NetworkProtocol",
                   lower(server_ports.external_port) AS "start!",
                   upper(server_ports.external_port) - 1 AS "end!",
                   servers.node,
                   servers.name AS server_name
               FROM server_ports
               JOIN servers ON servers.id = server_ports.server
               ORDER BY servers.node, server_ports.external_ip, server_ports.id"#
        )
        .fetch_all(&*backend.database)
        .await?;

        let mut findings = Vec::new();
        let mut claimed: HashMap<(Uuid, String, NetworkProtocol), Vec<PortClaim>> = HashMap::new();

        for row in rows {
            let label = format!("{} ({})", row.server_name, row.server);
            let port_subject =
                format!("{}:{}-{} {}", row.external_ip, row.start, row.end, row.name);

            if let Some(node) = nodes.get(&row.node) {
                let inside = node.ports.iter().any(|allocation| {
                    allocation.protocol == row.protocol
                        && allocation.start <= row.start
                        && allocation.end >= row.end
                });
                if !inside {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "Port {}-{} of server {label} is outside every range allocated to node \
                             {}",
                            row.start, row.end, node.display
                        ))
                        .with_subject(port_subject.clone())
                        .with_detail("node", subject(node))
                        .with_detail("protocol", row.protocol.to_string()),
                    );
                }
            }

            claimed
                .entry((row.node, row.external_ip, row.protocol))
                .or_default()
                .push(PortClaim {
                    start: row.start,
                    end: row.end,
                    label,
                    subject: port_subject,
                });
        }

        for ((_node, address, protocol), mut claims) in claimed {
            claims.sort_by_key(|claim| claim.start);
            for pair in claims.windows(2) {
                let (Some(left), Some(right)) = (pair.first(), pair.get(1)) else {
                    continue;
                };
                if right.start <= left.end {
                    findings.push(
                        IntegrityFinding::error(format!(
                            "The ports of {} and {} overlap on {address}",
                            left.label, right.label
                        ))
                        .with_subject(right.subject.clone())
                        .with_detail("protocol", protocol.to_string())
                        .with_detail("other", left.subject.clone()),
                    );
                }
            }
        }

        Ok(findings)
    }
}

struct PortClaim {
    start: i32,
    end: i32,
    label: String,
    subject: String,
}

fn display_hash(hash: &str) -> String {
    if hash.is_empty() {
        "unknown (the node predates the fingerprint)".to_owned()
    } else {
        hash.to_owned()
    }
}
