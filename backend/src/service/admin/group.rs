use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::group::{GroupLimits, MAX_GROUP_DEPTH, group_path, normalize_group_name};
use crate::service::admin::group::group_admin_service_error::{
    AssignGroupNodeError, CreateGroupError, DeleteGroupError, ListGroupsError, RemoveGroupNodeError,
};
use crate::service::*;
use crate::utils::task::detached;
use daemon_common::service::group::group_service_error::ConfigureGroupError;
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query, query_scalar};
use std::collections::HashMap;
use tracing::error;
use uuid::Uuid;
use zelus::service;

define_path_variable!(group_id "The group identifier");
define_path_variable!(node_id "The node identifier");

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateGroupPayload {
    pub(crate) name: String,
    pub(crate) parent: Option<i32>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct GroupInfo {
    pub(crate) id: i32,
    pub(crate) name: String,
    pub(crate) parent: Option<i32>,
    pub(crate) label: String,
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
    /// Lists all groups in tree order, parents before their subgroups, with the nodes assigned
    /// to them, the limits each group has on those nodes and how many deploy configs and
    /// database hosts use the group.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_groups(&self, #[special] auth: Authentication) -> Result<Vec<GroupInfo>, _> {
        auth.require::<_, _, ListGroupsError>((), ManagementPermissions::NODES_VIEW)?;

        let mut nodes: HashMap<i32, Vec<GroupNodeInfo>> = HashMap::new();
        for row in query!(
            r#"SELECT node_groups.group_id, node_groups.node, node_groups.cpu, node_groups.ram, node_groups.swap,
                      COUNT(servers.id) AS "server_count!"
               FROM node_groups
               LEFT JOIN servers ON servers.node = node_groups.node AND servers.group_id = node_groups.group_id
               GROUP BY node_groups.node, node_groups.group_id
               ORDER BY node_groups.node"#
        )
        .fetch_all(&*self.database)
        .await?
        {
            nodes.entry(row.group_id).or_default().push(GroupNodeInfo {
                node: row.node,
                limits: GroupLimits {
                    cpu: row.cpu,
                    ram: row.ram.map(i32::cast_unsigned),
                    swap: row.swap.map(i32::cast_unsigned),
                },
                server_count: row.server_count,
            });
        }

        Ok(query!(
            r#"SELECT group_paths.id AS "id!", group_paths.name AS "name!", group_paths.parent,
                      group_paths.label AS "label!",
                      (SELECT COUNT(*) FROM deploy_configs WHERE deploy_configs.group_id = group_paths.id) AS "deploy_config_count!",
                      (SELECT COUNT(*) FROM database_host_groups WHERE database_host_groups.group_id = group_paths.id) AS "database_host_count!"
               FROM group_paths
               ORDER BY group_paths.path"#
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| GroupInfo {
            id: row.id,
            name: row.name,
            parent: row.parent,
            label: row.label,
            nodes: nodes.remove(&row.id).unwrap_or_default(),
            deploy_config_count: row.deploy_config_count,
            database_host_count: row.database_host_count,
        })
        .collect())
    }

    /// Creates a group and returns its id. Groups are global and only take effect on the nodes
    /// assigned to them.
    ///
    /// Set `parent` to create a subgroup. On every node the limits of a parent group also
    /// apply to its subgroups, and groups can be nested at most 16 levels deep. Names are
    /// free text and only have to be unique among the groups sharing a parent.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(group::{not_found, invalid_name, already_exists <- [sql:unique], too_deep}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn create_group(
        &self,
        #[special] auth: Authentication,
        group: CreateGroupPayload,
    ) -> Result<i32, _> {
        auth.require::<_, _, CreateGroupError>((), ManagementPermissions::NODES_MANAGE)?;

        let name = normalize_group_name(&group.name).ok_or(CreateGroupError::GroupInvalidName)?;

        if let Some(parent) = group.parent {
            let parent = group_path(&*self.database, parent)
                .await?
                .ok_or(CreateGroupError::GroupNotFound)?;
            if parent.depth >= MAX_GROUP_DEPTH {
                return Err(CreateGroupError::GroupTooDeep);
            }
        }

        Ok(query_scalar!(
            "INSERT INTO groups (name, parent) VALUES ($1, $2) RETURNING id",
            name,
            group.parent
        )
        .fetch_one(&*self.database)
        .await?)
    }

    /// Deletes a group and removes it from every node. Servers in the group leave it and pick
    /// up the change on their next start. Groups with subgroups or used by deploy configs
    /// can't be deleted.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{group_id}", method = DELETE)]
    #[error(group::{not_found, has_subgroups, in_use <- [sql:foreign_key]}, node::failure, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn delete_group(&self, #[special] auth: Authentication, group_id: i32) -> Result<(), _> {
        auth.require::<_, _, DeleteGroupError>((), ManagementPermissions::NODES_MANAGE)?;

        let backend = self.clone();
        let mut conn = self.database.acquire().await?;
        detached(async move {
            conn.transaction(|tx| {
                Box::pin(async move {
                    let group = group_path(&mut **tx, group_id)
                        .await?
                        .ok_or(DeleteGroupError::GroupNotFound)?;

                    let has_subgroups = query_scalar!(
                        r#"SELECT EXISTS (SELECT 1 FROM groups WHERE parent = $1) AS "exists!""#,
                        group_id
                    )
                    .fetch_one(&mut **tx)
                    .await?;
                    if has_subgroups {
                        return Err(DeleteGroupError::GroupHasSubgroups);
                    }

                    let members: Vec<Uuid> =
                        query_scalar!("SELECT node FROM node_groups WHERE group_id = $1", group_id)
                            .fetch_all(&mut **tx)
                            .await?;

                    query!("DELETE FROM groups WHERE id = $1", group_id)
                        .execute(&mut **tx)
                        .await?;

                    let nodes = backend.nodes.read().await.clone();
                    for node in members.iter().filter_map(|id| nodes.get(id)) {
                        node.delete_group(group.daemon_name.clone())
                            .await
                            .map_err(|err| {
                                error!("Failed to delete group on node {}: {err:?}", node.id);
                                DeleteGroupError::NodeFailure
                            })?;
                    }

                    Ok(())
                })
            })
            .await
        })
        .await
    }

    /// Assigns a node to a group, or updates the limits the group has on that node. Omitted
    /// limits are unlimited. A subgroup can only be assigned to nodes its parent group is
    /// assigned to.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{group_id}/nodes/{node_id}", method = PUT)]
    #[error(group::{not_found, invalid_name, limits_invalid, parent_not_on_node}, node::{not_found, failure}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn assign_group_node(
        &self,
        #[special] auth: Authentication,
        group_id: i32,
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
        detached(async move {
            conn.transaction(|tx| {
                Box::pin(async move {
                    let group = group_path(&mut **tx, group_id)
                        .await?
                        .ok_or(AssignGroupNodeError::GroupNotFound)?;

                    if let Some(parent) = group.parent {
                        let parent_on_node = query_scalar!(
                            r#"SELECT EXISTS (SELECT 1 FROM node_groups WHERE node = $1 AND group_id = $2) AS "exists!""#,
                            node_id,
                            parent
                        )
                        .fetch_one(&mut **tx)
                        .await?;
                        if !parent_on_node {
                            return Err(AssignGroupNodeError::GroupParentNotOnNode);
                        }
                    }

                    query!(
                        r#"INSERT INTO node_groups (node, group_id, cpu, ram, swap) VALUES ($1, $2, $3, $4, $5)
                           ON CONFLICT (node, group_id) DO UPDATE SET cpu = $3, ram = $4, swap = $5"#,
                        node_id,
                        group_id,
                        limits.cpu,
                        limits.ram.map(u32::cast_signed),
                        limits.swap.map(u32::cast_signed),
                    )
                    .execute(&mut **tx)
                    .await?;

                    node.configure_group(group.daemon_name, limits.cpu, limits.ram, limits.swap)
                        .await
                        .map_err(|err| match err {
                            ConfigureGroupError::GroupInvalidName => AssignGroupNodeError::GroupInvalidName,
                            err => {
                                error!("Failed to configure group: {err:?}");
                                AssignGroupNodeError::NodeFailure
                            }
                        })?;

                    Ok(())
                })
            })
            .await
        })
        .await
    }

    /// Removes a node from a group. The node's servers in the group leave it and pick up the
    /// change on their next start. The node has to be removed from the group's subgroups first.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{group_id}/nodes/{node_id}", method = DELETE)]
    #[error(group::{not_on_node, subgroups_on_node}, node::{not_found, failure}, auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn remove_group_node(
        &self,
        #[special] auth: Authentication,
        group_id: i32,
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
        detached(async move {
            conn.transaction(|tx| {
                Box::pin(async move {
                    let group = group_path(&mut **tx, group_id)
                        .await?
                        .ok_or(RemoveGroupNodeError::GroupNotOnNode)?;

                    let subgroups_on_node = query_scalar!(
                        r#"SELECT EXISTS (
                           SELECT 1 FROM node_groups
                           JOIN groups ON groups.id = node_groups.group_id
                           WHERE node_groups.node = $1 AND groups.parent = $2
                       ) AS "exists!""#,
                        node_id,
                        group_id
                    )
                    .fetch_one(&mut **tx)
                    .await?;
                    if subgroups_on_node {
                        return Err(RemoveGroupNodeError::GroupSubgroupsOnNode);
                    }

                    let deleted = query!(
                        "DELETE FROM node_groups WHERE node = $1 AND group_id = $2",
                        node_id,
                        group_id,
                    )
                    .execute(&mut **tx)
                    .await?
                    .rows_affected();
                    if deleted == 0 {
                        return Err(RemoveGroupNodeError::GroupNotOnNode);
                    }

                    node.delete_group(group.daemon_name).await.map_err(|err| {
                        error!("Failed to delete group: {err:?}");
                        RemoveGroupNodeError::NodeFailure
                    })?;

                    Ok(())
                })
            })
            .await
        })
        .await
    }
}
