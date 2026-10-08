use serde::{Deserialize, Serialize};
use sqlx::{Executor, Postgres, query, query_scalar};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const MAX_GROUP_NAME_LENGTH: usize = 64;

pub const MAX_GROUP_DEPTH: i32 = 16;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, utoipa::ToSchema)]
pub struct GroupLimits {
    pub cpu: Option<f32>,
    pub ram: Option<u32>,
    pub swap: Option<u32>,
}

impl GroupLimits {
    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.cpu.is_none_or(|cpu| cpu.is_finite() && cpu > 0.0)
            && self.ram.is_none_or(|ram| ram > 0)
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GroupRef {
    pub id: i32,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct GroupPath {
    pub id: i32,
    pub parent: Option<i32>,
    pub label: String,
    pub daemon_name: String,
    pub depth: i32,
}

#[must_use]
pub fn normalize_group_name(name: &str) -> Option<String> {
    let name = name.trim();
    let length = name.chars().count();
    (length > 0 && length <= MAX_GROUP_NAME_LENGTH && !name.chars().any(char::is_control))
        .then(|| name.to_owned())
}

pub async fn group_path(
    conn: impl Executor<'_, Database = Postgres>,
    id: i32,
) -> Result<Option<GroupPath>, sqlx::Error> {
    Ok(query!(
        r#"SELECT id AS "id!", parent, label AS "label!", daemon_name AS "daemon_name!", depth AS "depth!"
           FROM group_paths WHERE id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?
    .map(|row| GroupPath {
        id: row.id,
        parent: row.parent,
        label: row.label,
        daemon_name: row.daemon_name,
        depth: row.depth,
    }))
}

pub async fn group_labels(
    conn: impl Executor<'_, Database = Postgres>,
) -> Result<HashMap<i32, String>, sqlx::Error> {
    Ok(
        query!(r#"SELECT id AS "id!", label AS "label!" FROM group_paths"#)
            .fetch_all(conn)
            .await?
            .into_iter()
            .map(|row| (row.id, row.label))
            .collect(),
    )
}

pub fn group_refs(
    labels: &HashMap<i32, String>,
    ids: impl IntoIterator<Item = i32>,
) -> Vec<GroupRef> {
    let mut refs: Vec<GroupRef> = ids
        .into_iter()
        .filter_map(|id| {
            labels.get(&id).map(|label| GroupRef {
                id,
                label: label.clone(),
            })
        })
        .collect();
    refs.sort_by(|left, right| left.label.cmp(&right.label));
    refs
}

pub async fn node_in_group(
    conn: impl Executor<'_, Database = Postgres>,
    node: Uuid,
    group: i32,
) -> Result<bool, sqlx::Error> {
    query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM node_groups WHERE node = $1 AND group_id = $2) AS "exists!""#,
        node,
        group
    )
    .fetch_one(conn)
    .await
}

pub async fn all_groups_exist(
    conn: impl Executor<'_, Database = Postgres>,
    groups: &[i32],
) -> Result<bool, sqlx::Error> {
    let found = query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM groups WHERE id = ANY($1)"#,
        groups
    )
    .fetch_one(conn)
    .await?;
    let unique: HashSet<&i32> = groups.iter().collect();
    Ok(usize::try_from(found).is_ok_and(|found| found == unique.len()))
}
