use lazy_regex::regex_is_match;
use serde::{Deserialize, Serialize};
use sqlx::{Executor, Postgres, query_scalar};
use std::collections::HashSet;
use uuid::Uuid;

const MAX_GROUP_NAME_LENGTH: usize = 200;

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

#[must_use]
pub fn valid_group_name(name: &str) -> bool {
    name.len() <= MAX_GROUP_NAME_LENGTH
        && regex_is_match!(r"^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$", name)
}

pub async fn node_in_group(
    conn: impl Executor<'_, Database = Postgres>,
    node: Uuid,
    group: &str,
) -> Result<bool, sqlx::Error> {
    query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM node_groups WHERE node = $1 AND group_name = $2) AS "exists!""#,
        node,
        group
    )
    .fetch_one(conn)
    .await
}

pub async fn all_groups_exist(
    conn: impl Executor<'_, Database = Postgres>,
    groups: &[String],
) -> Result<bool, sqlx::Error> {
    let found = query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM groups WHERE name = ANY($1)"#,
        groups
    )
    .fetch_one(conn)
    .await?;
    let unique: HashSet<&String> = groups.iter().collect();
    Ok(usize::try_from(found).is_ok_and(|found| found == unique.len()))
}

#[cfg(test)]
mod tests {
    use super::{GroupLimits, valid_group_name};

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

    #[test]
    fn group_limits() {
        assert!(GroupLimits::default().is_valid());
        assert!(
            GroupLimits {
                cpu: Some(0.5),
                ram: Some(512),
                swap: Some(0)
            }
            .is_valid()
        );
        assert!(
            !GroupLimits {
                cpu: Some(0.0),
                ..GroupLimits::default()
            }
            .is_valid()
        );
        assert!(
            !GroupLimits {
                ram: Some(0),
                ..GroupLimits::default()
            }
            .is_valid()
        );
    }
}
