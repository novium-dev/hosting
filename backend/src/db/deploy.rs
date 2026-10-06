use crate::Backend;
use crate::db::group::GroupRef;
use crate::db::node::{BackendNode, NodePortAllocation, used_ports};
use crate::db::server::ports::NetworkProtocol;
use crate::templates::TemplatePortDefinition;
use daemon_common::service::resource::ResourceResponse;
use futures::future::join_all;
use serde::Serialize;
use sqlx::query;
use sqlx::types::Json;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use tracing::warn;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DeployConfig {
    pub id: i32,
    pub name: String,
    pub group: GroupRef,
    pub template: String,
    pub variables: HashMap<String, String>,
    pub cpu: f32,
    pub ram: u32,
    pub swap: u32,
    pub disk: Option<u64>,
    pub internet_access: bool,
    pub backup_limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Demand {
    pub cpu: f64,
    pub ram: u64,
    pub swap: u64,
    pub disk: Option<u64>,
}

impl From<&DeployConfig> for Demand {
    fn from(config: &DeployConfig) -> Self {
        Self {
            cpu: f64::from(config.cpu),
            ram: u64::from(config.ram),
            swap: u64::from(config.swap),
            disk: config.disk,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NodeCapacity {
    pub cpu: f64,
    pub ram: u64,
    pub swap: u64,
    pub storage: HashMap<String, u64>,
}

impl NodeCapacity {
    #[expect(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "capacities are far below the precision limits of f64"
    )]
    pub fn from_metrics(metrics: &ResourceResponse, overallocation: u16) -> Self {
        let factor = f64::from(overallocation) / 100.0f64;
        let scale = |value: u64| (value as f64 * factor) as u64;
        let limited =
            |hardware: u64, limit: Option<u64>| limit.map_or(hardware, |limit| hardware.min(limit));

        let cpu = metrics.server.cpu_limit_effective.map_or_else(
            || f64::from(metrics.cpu_count),
            |limit| limit.min(f64::from(metrics.cpu_count)),
        );

        Self {
            cpu: cpu * factor,
            ram: scale(limited(
                metrics.mem_total,
                metrics.server.mem_limit_effective,
            )),
            swap: scale(limited(
                metrics.swap_total,
                metrics.server.swap_limit_effective,
            )),
            storage: metrics
                .storage
                .server
                .iter()
                .map(|(id, entry)| (id.clone(), scale(entry.total)))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NodeAllocation {
    pub cpu: f64,
    pub ram: u64,
    pub swap: u64,
    pub storage: HashMap<String, u64>,
}

pub struct Placement {
    pub node: Arc<BackendNode>,
    pub storage: String,
    pub ports: HashMap<String, u16>,
}

#[expect(clippy::cast_precision_loss, reason = "only used to rank nodes")]
pub fn fit(
    capacity: &NodeCapacity,
    allocation: &NodeAllocation,
    demand: &Demand,
    storages: &[String],
) -> Option<(String, f64)> {
    let free_cpu = capacity.cpu - allocation.cpu - demand.cpu;
    let free_ram = capacity
        .ram
        .checked_sub(allocation.ram)?
        .checked_sub(demand.ram)?;
    if free_cpu < 0.0f64 {
        return None;
    }
    if demand.swap > 0 && allocation.swap.saturating_add(demand.swap) > capacity.swap {
        return None;
    }

    let storage = storages.iter().find(|storage| {
        demand.disk.is_none_or(|disk| {
            capacity.storage.get(*storage).is_some_and(|total| {
                allocation
                    .storage
                    .get(*storage)
                    .copied()
                    .unwrap_or_default()
                    .saturating_add(disk)
                    <= *total
            })
        })
    })?;

    let cpu_score = if capacity.cpu > 0.0f64 {
        free_cpu / capacity.cpu
    } else {
        0.0f64
    };
    let ram_score = if capacity.ram > 0 {
        free_ram as f64 / capacity.ram as f64
    } else {
        0.0f64
    };

    Some((storage.clone(), cpu_score.min(ram_score)))
}

type BindingKey = (bool, u16, String);
type Binding<'a> = (Vec<&'a str>, HashSet<NetworkProtocol>);

pub fn allocate_ports(
    definitions: &HashMap<String, TemplatePortDefinition>,
    allocations: &[NodePortAllocation],
    used: &HashMap<NetworkProtocol, HashSet<u16>>,
) -> Option<HashMap<String, u16>> {
    let mut bindings: BTreeMap<BindingKey, Binding<'_>> = BTreeMap::new();
    for (name, definition) in definitions {
        let key = if definition.remappable {
            (true, definition.internal_port, name.clone())
        } else {
            (false, definition.internal_port, String::new())
        };
        let entry = bindings.entry(key).or_default();
        entry.0.push(name);
        entry.1.insert(definition.protocol);
    }

    let mut taken: HashMap<NetworkProtocol, HashSet<u16>> = HashMap::new();
    let mut result = HashMap::with_capacity(definitions.len());

    for ((_, internal_port, _), (names, protocols)) in bindings {
        let available = |port: u16, taken: &HashMap<NetworkProtocol, HashSet<u16>>| {
            protocols.iter().all(|protocol| {
                allocations.iter().any(|allocation| {
                    allocation.protocol == *protocol
                        && allocation.start <= i32::from(port)
                        && allocation.end >= i32::from(port)
                }) && !used
                    .get(protocol)
                    .is_some_and(|ports| ports.contains(&port))
                    && !taken
                        .get(protocol)
                        .is_some_and(|ports| ports.contains(&port))
            })
        };

        let mut candidates: Vec<u16> = allocations
            .iter()
            .filter(|allocation| protocols.contains(&allocation.protocol))
            .flat_map(|allocation| allocation.start..=allocation.end)
            .filter_map(|port| u16::try_from(port).ok())
            .collect();
        candidates.sort_unstable();
        candidates.dedup();

        let port = core::iter::once(internal_port)
            .chain(candidates)
            .find(|port| available(*port, &taken))?;

        for protocol in protocols {
            taken.entry(protocol).or_default().insert(port);
        }
        for name in names {
            result.insert(name.to_owned(), port);
        }
    }

    Some(result)
}

impl Backend {
    pub async fn load_deploy_configs(
        &self,
        id: Option<i32>,
    ) -> Result<Vec<DeployConfig>, sqlx::Error> {
        Ok(query!(
            r#"SELECT deploy_configs.id, deploy_configs.name, deploy_configs.group_id,
                      group_paths.label AS "group_label!", deploy_configs.template,
                      deploy_configs.variables AS "variables: Json<HashMap<String, String>>",
                      deploy_configs.cpu, deploy_configs.ram, deploy_configs.swap, deploy_configs.disk,
                      deploy_configs.internet_access, deploy_configs.backup_limit
               FROM deploy_configs
               JOIN group_paths ON group_paths.id = deploy_configs.group_id
               WHERE $1::integer IS NULL OR deploy_configs.id = $1
               ORDER BY deploy_configs.name"#,
            id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| DeployConfig {
            id: row.id,
            name: row.name,
            group: GroupRef {
                id: row.group_id,
                label: row.group_label,
            },
            template: row.template,
            variables: row.variables.0,
            cpu: row.cpu,
            ram: row.ram.cast_unsigned(),
            swap: row.swap.cast_unsigned(),
            disk: row.disk.map(i64::cast_unsigned),
            internet_access: row.internet_access,
            backup_limit: row.backup_limit.map(i32::cast_unsigned),
        })
        .collect())
    }

    pub async fn place_deploy(
        &self,
        config: &DeployConfig,
        definitions: &HashMap<String, TemplatePortDefinition>,
        node: Option<Uuid>,
    ) -> Result<Option<Placement>, sqlx::Error> {
        let members: HashSet<Uuid> = query!(
            "SELECT node FROM node_groups WHERE group_id = $1",
            config.group.id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| row.node)
        .collect();

        let candidates: Vec<Arc<BackendNode>> = self
            .nodes
            .read()
            .await
            .values()
            .filter(|candidate| {
                members.contains(&candidate.id)
                    && !candidate.maintenance
                    && node.is_none_or(|node| node == candidate.id)
            })
            .cloned()
            .collect();
        if candidates.is_empty() {
            return Ok(None);
        }

        let node_ids: Vec<Uuid> = candidates.iter().map(|node| node.id).collect();
        let mut allocations: HashMap<Uuid, NodeAllocation> = HashMap::new();
        for row in query!(
            r#"SELECT node, storage,
                      COALESCE(SUM(cpu), 0)::float8 AS "cpu!",
                      COALESCE(SUM(ram), 0)::bigint AS "ram!",
                      COALESCE(SUM(swap), 0)::bigint AS "swap!",
                      COALESCE(SUM(disk), 0)::bigint AS "disk!"
               FROM servers
               WHERE node = ANY($1)
               GROUP BY node, storage"#,
            &node_ids
        )
        .fetch_all(&*self.database)
        .await?
        {
            let allocation = allocations.entry(row.node).or_default();
            allocation.cpu += row.cpu;
            allocation.ram = allocation.ram.saturating_add(row.ram.cast_unsigned());
            allocation.swap = allocation.swap.saturating_add(row.swap.cast_unsigned());
            allocation
                .storage
                .insert(row.storage, row.disk.cast_unsigned());
        }

        let metrics = join_all(candidates.iter().map(|node| async move {
            node.resource_info()
                .await
                .inspect_err(|err| {
                    warn!(
                        "Skipping node {} for deploy, metrics unavailable: {err:?}",
                        node.id
                    );
                })
                .ok()
        }))
        .await;

        let demand = Demand::from(config);
        let mut best: Option<(f64, Placement)> = None;
        for (node, metrics) in candidates.into_iter().zip(metrics) {
            let Some(metrics) = metrics else {
                continue;
            };
            let capacity = NodeCapacity::from_metrics(&metrics, node.overallocation);
            let allocation = allocations.remove(&node.id).unwrap_or_default();
            let Some((storage, score)) =
                fit(&capacity, &allocation, &demand, &node.server_storages)
            else {
                continue;
            };
            if best.as_ref().is_some_and(|(best, _)| *best >= score) {
                continue;
            }
            let used = used_ports(&*self.database, node.id).await?;
            let Some(ports) = allocate_ports(definitions, &node.ports, &used) else {
                continue;
            };
            best = Some((
                score,
                Placement {
                    node,
                    storage,
                    ports,
                },
            ));
        }

        Ok(best.map(|(_, placement)| placement))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capacity() -> NodeCapacity {
        NodeCapacity {
            cpu: 8.0,
            ram: 16 * 1024,
            swap: 2048,
            storage: HashMap::from([("ssd".to_owned(), 100_000)]),
        }
    }

    fn demand() -> Demand {
        Demand {
            cpu: 2.0,
            ram: 4096,
            swap: 0,
            disk: Some(10_000),
        }
    }

    #[test]
    fn fits_empty_node() {
        let (storage, score) = fit(
            &capacity(),
            &NodeAllocation::default(),
            &demand(),
            &["ssd".to_owned()],
        )
        .expect("fits");
        assert_eq!(storage, "ssd");
        assert!((score - 0.75).abs() < f64::EPSILON);
    }

    #[test]
    fn rejects_when_full() {
        let allocation = NodeAllocation {
            cpu: 7.0,
            ..NodeAllocation::default()
        };
        assert!(fit(&capacity(), &allocation, &demand(), &["ssd".to_owned()]).is_none());

        let allocation = NodeAllocation {
            ram: 14000,
            ..NodeAllocation::default()
        };
        assert!(fit(&capacity(), &allocation, &demand(), &["ssd".to_owned()]).is_none());

        let allocation = NodeAllocation {
            storage: HashMap::from([("ssd".to_owned(), 95_000)]),
            ..NodeAllocation::default()
        };
        assert!(fit(&capacity(), &allocation, &demand(), &["ssd".to_owned()]).is_none());
    }

    #[test]
    fn overallocation_scales_capacity() {
        let metrics: ResourceResponse = serde_json::from_value(serde_json::json!({
            "mem_total": 1000u64,
            "swap_total": 100u64,
            "cpu_count": 4u32,
            "system": subset(),
            "server": subset(),
            "groups": {},
            "storage": { "server": { "ssd": { "path": "/", "free": 0u64, "available": 0u64, "total": 1000u64 } }, "backup": {} },
        }))
        .expect("metrics");
        let capacity = NodeCapacity::from_metrics(&metrics, 120);
        assert!((capacity.cpu - 4.8).abs() < 1e-9f64);
        assert_eq!(capacity.ram, 1200);
        assert_eq!(capacity.swap, 120);
        assert_eq!(capacity.storage.get("ssd"), Some(&1200));
    }

    fn subset() -> serde_json::Value {
        serde_json::json!({
            "mem_limit": null, "mem_limit_effective": null, "mem_used": 0, "mem_allocated": 0,
            "swap_limit": null, "swap_limit_effective": null, "swap_used": 0, "swap_allocated": 0,
            "cpu_limit": null, "cpu_limit_effective": null, "cpu_used": 0.0, "cpu_allocated": 0.0,
        })
    }

    fn definition(
        protocol: NetworkProtocol,
        internal_port: u16,
        remappable: bool,
    ) -> TemplatePortDefinition {
        TemplatePortDefinition {
            protocol,
            internal_port,
            placeholder: String::new(),
            remappable,
            http: false,
        }
    }

    fn range(protocol: NetworkProtocol, start: i32, end: i32) -> NodePortAllocation {
        NodePortAllocation {
            id: 0,
            node: Uuid::nil(),
            protocol,
            start,
            end,
        }
    }

    #[test]
    fn allocates_free_ports() {
        let definitions = HashMap::from([
            (
                "game".to_owned(),
                definition(NetworkProtocol::Tcp, 25565, true),
            ),
            (
                "query".to_owned(),
                definition(NetworkProtocol::Udp, 25565, true),
            ),
        ]);
        let allocations = [
            range(NetworkProtocol::Tcp, 30000, 30010),
            range(NetworkProtocol::Udp, 30000, 30010),
        ];
        let used = HashMap::from([(NetworkProtocol::Tcp, HashSet::from([30000]))]);

        let ports = allocate_ports(&definitions, &allocations, &used).expect("ports");
        assert_eq!(ports.get("game"), Some(&30001));
        assert_eq!(ports.get("query"), Some(&30000));
    }

    #[test]
    fn shares_port_for_fixed_bindings() {
        let definitions = HashMap::from([
            (
                "tcp".to_owned(),
                definition(NetworkProtocol::Tcp, 9987, false),
            ),
            (
                "udp".to_owned(),
                definition(NetworkProtocol::Udp, 9987, false),
            ),
        ]);
        let allocations = [
            range(NetworkProtocol::Tcp, 9000, 9100),
            range(NetworkProtocol::Udp, 9050, 9100),
        ];
        let used = HashMap::from([(NetworkProtocol::Udp, HashSet::from([9050]))]);

        let ports = allocate_ports(&definitions, &allocations, &used).expect("ports");
        assert_eq!(ports.get("tcp"), Some(&9051));
        assert_eq!(ports.get("udp"), Some(&9051));
    }

    #[test]
    fn prefers_internal_port_and_fails_when_exhausted() {
        let definitions = HashMap::from([(
            "game".to_owned(),
            definition(NetworkProtocol::Tcp, 25565, false),
        )]);
        let allocations = [range(NetworkProtocol::Tcp, 25560, 25570)];
        let ports = allocate_ports(&definitions, &allocations, &HashMap::new()).expect("ports");
        assert_eq!(ports.get("game"), Some(&25565));

        let used = HashMap::from([(NetworkProtocol::Tcp, (25560..=25570).collect())]);
        assert!(allocate_ports(&definitions, &allocations, &used).is_none());
    }
}
