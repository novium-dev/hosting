use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::group::{GroupLimits, valid_group_name};
use crate::service::admin::group::group_admin_service_error::{
    AssignGroupNodeError, CreateGroupError, DeleteGroupError, ListGroupsError, RemoveGroupNodeError,
};
use crate::service::*;
use daemon_common::service::group::group_service_error::ConfigureGroupError;
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query};
use std::collections::BTreeMap;
use tracing::error;
use uuid::Uuid;
use zelus::service;

define_path_variable!(group_name "The group name");
define_path_variable!(node_id "The node identifier");

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateGroupPayload {
    pub(crate) name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct GroupInfo {
    pub(crate) name: String,
    pub(crate) nodes: Vec<GroupNodeInfo>,
    pub(crate) deploy_config_count: i64,
    pub(crate) database_host_count: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct GroupNodeInfo {
    pub(crate) node: Uuid,
    pub(crate) limits: GroupLimits,
    pub(crate) server_count: i64,
}

#[service(path = "/admin/group", tag = "group", no_sdk)]
pub(crate) impl GroupAdminService for Backend {
    /// Lists all groups with the nodes assigned to them, the limits each group has on those
    /// nodes and the number of deploy configs targeting the group.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_groups(&self, #[special] auth: Authentication) -> Result<Vec<GroupInfo>, _> {
        auth.require::<_, _, ListGroupsError>((), ManagementPermissions::NODES_VIEW)?;

        let mut groups: BTreeMap<String, GroupInfo> = query!(
            r#"SELECT groups.name,
                      (SELECT COUNT(*) FROM deploy_configs WHERE deploy_configs.group_name = groups.name) AS "deploy_config_count!",
                      (SELECT COUNT(*) FROM database_host_groups WHERE database_host_groups.group_name = groups.name) AS "database_host_count!"
               FROM groups"#
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| {
            (
                row.name.clone(),
                GroupInfo {
                    name: row.name,
                    nodes: Vec::new(),
                    deploy_config_count: row.deploy_config_count,
                    database_host_count: row.database_host_count,
                },
            )
        })
        .collect();

        for row in query!(
            r#"SELECT node_groups.group_name, node_groups.node, node_groups.cpu, node_groups.ram, node_groups.swap,
                      COUNT(servers.id) AS "server_count!"
               FROM node_groups
               LEFT JOIN servers ON servers.node = node_groups.node AND servers.node_group = node_groups.group_name
               GROUP BY node_groups.node, node_groups.group_name
               ORDER BY node_groups.node"#
        )
        .fetch_all(&*self.database)
        .await?
        {
            if let Some(group) = groups.get_mut(&row.group_name) {
                group.nodes.push(GroupNodeInfo {
                    node: row.node,
                    limits: GroupLimits {
                        cpu: row.cpu,
                        ram: row.ram.map(i32::cast_unsigned),
                        swap: row.swap.map(i32::cast_unsigned),
                    },
                    server_count: row.server_count,
                });
            }
        }

        Ok(groups.into_values().collect())
    }

    /// Creates a group. Groups are global and only take effect on the nodes assigned to them.
    ///
    /// Group names consist of letters, numbers and underscores. A `-` nests a group inside
    /// another one, e.g. `customers-acme` lives inside `customers`, and on every node the
    /// limits of a parent group also apply to its subgroups.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(group::{invalid_name, already_exists <- [sql:unique]}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn create_group(
        &self,
        #[special] auth: Authentication,
        group: CreateGroupPayload,
    ) -> Result<(), _> {
        auth.require::<_, _, CreateGroupError>((), ManagementPermissions::NODES_MANAGE)?;

        if !valid_group_name(&group.name) {
            return Err(CreateGroupError::GroupInvalidName);
        }

        query!("INSERT INTO groups (name) VALUES ($1)", group.name)
            .execute(&*self.database)
            .await?;

        Ok(())
    }

    /// Deletes a group and removes it from every node. Servers in the group leave it and pick
    /// up the change on their next start. Groups still targeted by deploy configs can't be
    /// deleted.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{group_name}", method = DELETE)]
    #[error(group::{not_found, in_use <- [sql:foreign_key]}, node::failure, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn delete_group(
        &self,
        #[special] auth: Authentication,
        group_name: String,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteGroupError>((), ManagementPermissions::NODES_MANAGE)?;

        let backend = self.clone();
        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                let members: Vec<Uuid> = query!(
                    "SELECT node FROM node_groups WHERE group_name = $1",
                    &group_name
                )
                .fetch_all(&mut **tx)
                .await?
                .into_iter()
                .map(|row| row.node)
                .collect();

                let deleted = query!("DELETE FROM groups WHERE name = $1", &group_name)
                    .execute(&mut **tx)
                    .await?
                    .rows_affected();
                if deleted == 0 {
                    return Err(DeleteGroupError::GroupNotFound);
                }

                let nodes = backend.nodes.read().await.clone();
                for node in members.iter().filter_map(|id| nodes.get(id)) {
                    node.delete_group(group_name.clone()).await.map_err(|err| {
                        error!("Failed to delete group on node {}: {err:?}", node.id);
                        DeleteGroupError::NodeFailure
                    })?;
                }

                Ok(())
            })
        })
        .await
    }

    /// Assigns a node to a group, or updates the limits the group has on that node. Omitted
    /// limits are unlimited.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{group_name}/nodes/{node_id}", method = PUT)]
    #[error(group::{not_found <- [sql:foreign_key], invalid_name, limits_invalid}, node::{not_found, failure}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn assign_group_node(
        &self,
        #[special] auth: Authentication,
        group_name: String,
        node_id: Uuid,
        limits: GroupLimits,
    ) -> Result<(), _> {
        auth.require::<_, _, AssignGroupNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        if !limits.is_valid() {
            return Err(AssignGroupNodeError::GroupLimitsInvalid);
        }

        let node = self
            .nodes
            .read()
            .await
            .get(&node_id)
            .cloned()
            .ok_or(AssignGroupNodeError::NodeNotFound)?;

        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                query!(
                    r#"INSERT INTO node_groups (node, group_name, cpu, ram, swap) VALUES ($1, $2, $3, $4, $5)
                       ON CONFLICT (node, group_name) DO UPDATE SET cpu = $3, ram = $4, swap = $5"#,
                    node_id,
                    &group_name,
                    limits.cpu,
                    limits.ram.map(u32::cast_signed),
                    limits.swap.map(u32::cast_signed),
                )
                .execute(&mut **tx)
                .await?;

                node.configure_group(group_name, limits.cpu, limits.ram, limits.swap)
                    .await
                    .map_err(|err| match err {
                        ConfigureGroupError::GroupInvalidName => {
                            AssignGroupNodeError::GroupInvalidName
                        }
                        err => {
                            error!("Failed to configure group: {err:?}");
                            AssignGroupNodeError::NodeFailure
                        }
                    })?;

                Ok(())
            })
        })
        .await
    }

    /// Removes a node from a group. The node's servers in the group leave it and pick up the
    /// change on their next start.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{group_name}/nodes/{node_id}", method = DELETE)]
    #[error(group::not_on_node, node::{not_found, failure}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn remove_group_node(
        &self,
        #[special] auth: Authentication,
        group_name: String,
        node_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, RemoveGroupNodeError>((), ManagementPermissions::NODES_MANAGE)?;

        let node = self
            .nodes
            .read()
            .await
            .get(&node_id)
            .cloned()
            .ok_or(RemoveGroupNodeError::NodeNotFound)?;

        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                let deleted = query!(
                    "DELETE FROM node_groups WHERE node = $1 AND group_name = $2",
                    node_id,
                    &group_name,
                )
                .execute(&mut **tx)
                .await?
                .rows_affected();
                if deleted == 0 {
                    return Err(RemoveGroupNodeError::GroupNotOnNode);
                }

                node.delete_group(group_name).await.map_err(|err| {
                    error!("Failed to delete group: {err:?}");
                    RemoveGroupNodeError::NodeFailure
                })?;

                Ok(())
            })
        })
        .await
    }
}
