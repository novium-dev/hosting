use lazy_regex::regex_is_match;
use serde::Serialize;
use sqlx::{Executor, Postgres, query_scalar};
use uuid::Uuid;

const MAX_GROUP_NAME_LENGTH: usize = 200;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NodeGroup {
    pub name: String,
    pub cpu: Option<f32>,
    pub ram: Option<u32>,
    pub swap: Option<u32>,
    pub server_count: i64,
}

#[must_use]
pub fn valid_group_name(name: &str) -> bool {
    name.len() <= MAX_GROUP_NAME_LENGTH
        && regex_is_match!(r"^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$", name)
}

pub async fn group_exists(
    conn: impl Executor<'_, Database = Postgres>,
    node: Uuid,
    name: &str,
) -> Result<bool, sqlx::Error> {
    query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM node_groups WHERE node = $1 AND name = $2) AS "exists!""#,
        node,
        name
    )
    .fetch_one(conn)
    .await
}

#[cfg(test)]
mod tests {
    use super::valid_group_name;

    #[test]
    fn group_names() {
        assert!(valid_group_name("customers"));
        assert!(valid_group_name("customers-acme_1"));
        assert!(!valid_group_name(""));
        assert!(!valid_group_name("-customers"));
        assert!(!valid_group_name("customers-"));
        assert!(!valid_group_name("a b"));
        assert!(valid_group_name(&format!("{}a", "a-".repeat(15))));
        assert!(!valid_group_name(&format!("{}a", "a-".repeat(16))));
        assert!(!valid_group_name(&"a".repeat(201)));
    }
}
