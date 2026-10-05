use core::time::Duration;
use daemon_common::node::SetupNodeConfig;
use database_agent_common::types::SetupAgentConfig;
use sqlx::types::Json;
use sqlx::{Executor, Postgres, query, query_as};

pub(crate) const REGISTRATION_TIMEOUT: Duration = Duration::from_hours(1);

pub(crate) struct NodeRegistration {
    pub(crate) code: String,
    pub(crate) name: String,
    pub(crate) default_host: String,
    pub(crate) config: Json<SetupNodeConfig>,
    pub(crate) expires_in: i64,
}

pub(crate) struct DatabaseHostRegistration {
    pub(crate) code: String,
    pub(crate) display: String,
    pub(crate) groups: Vec<String>,
    pub(crate) public_host: String,
    pub(crate) config: Json<SetupAgentConfig>,
    pub(crate) expires_in: i64,
}

pub(crate) async fn insert_node_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
    name: &str,
    default_host: &str,
    config: &SetupNodeConfig,
) -> Result<(), sqlx::Error> {
    query!(
        "INSERT INTO node_registrations (code, name, default_host, config, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))",
        code,
        name,
        default_host,
        Json(config) as _,
        REGISTRATION_TIMEOUT.as_secs_f64()
    )
    .execute(executor)
    .await?;
    Ok(())
}

pub(crate) async fn node_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
) -> Result<Option<NodeRegistration>, sqlx::Error> {
    query_as!(
        NodeRegistration,
        r#"SELECT code, name, default_host, config AS "config: Json<SetupNodeConfig>",
               EXTRACT(EPOCH FROM expires_at - now())::BIGINT AS "expires_in!"
           FROM node_registrations WHERE code = $1 AND expires_at > now()"#,
        code
    )
    .fetch_optional(executor)
    .await
}

pub(crate) async fn claim_node_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
) -> Result<Option<NodeRegistration>, sqlx::Error> {
    query_as!(
        NodeRegistration,
        r#"DELETE FROM node_registrations WHERE code = $1 AND expires_at > now()
           RETURNING code, name, default_host, config AS "config: Json<SetupNodeConfig>",
               EXTRACT(EPOCH FROM expires_at - now())::BIGINT AS "expires_in!""#,
        code
    )
    .fetch_optional(executor)
    .await
}

pub(crate) async fn list_node_registrations(
    executor: impl Executor<'_, Database = Postgres> + Copy,
) -> Result<Vec<NodeRegistration>, sqlx::Error> {
    query!("DELETE FROM node_registrations WHERE expires_at <= now()")
        .execute(executor)
        .await?;

    query_as!(
        NodeRegistration,
        r#"SELECT code, name, default_host, config AS "config: Json<SetupNodeConfig>",
               EXTRACT(EPOCH FROM expires_at - now())::BIGINT AS "expires_in!"
           FROM node_registrations ORDER BY expires_at"#
    )
    .fetch_all(executor)
    .await
}

pub(crate) async fn update_node_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
    name: &str,
    default_host: &str,
    config: &SetupNodeConfig,
) -> Result<bool, sqlx::Error> {
    Ok(query!(
        "UPDATE node_registrations SET name = $2, default_host = $3, config = $4
         WHERE code = $1 AND expires_at > now()",
        code,
        name,
        default_host,
        Json(config) as _
    )
    .execute(executor)
    .await?
    .rows_affected()
        > 0)
}

pub(crate) async fn extend_node_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
) -> Result<bool, sqlx::Error> {
    Ok(query!(
        "UPDATE node_registrations SET expires_at = now() + make_interval(secs => $2)
         WHERE code = $1",
        code,
        REGISTRATION_TIMEOUT.as_secs_f64()
    )
    .execute(executor)
    .await?
    .rows_affected()
        > 0)
}

pub(crate) async fn insert_database_host_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
    display: &str,
    groups: &[String],
    public_host: &str,
    config: &SetupAgentConfig,
) -> Result<(), sqlx::Error> {
    query!(
        "INSERT INTO database_host_registrations (code, display, groups, public_host, config, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))",
        code,
        display,
        groups,
        public_host,
        Json(config) as _,
        REGISTRATION_TIMEOUT.as_secs_f64()
    )
    .execute(executor)
    .await?;
    Ok(())
}

pub(crate) async fn database_host_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
) -> Result<Option<DatabaseHostRegistration>, sqlx::Error> {
    query_as!(
        DatabaseHostRegistration,
        r#"SELECT code, display, groups, public_host, config AS "config: Json<SetupAgentConfig>",
               EXTRACT(EPOCH FROM expires_at - now())::BIGINT AS "expires_in!"
           FROM database_host_registrations WHERE code = $1 AND expires_at > now()"#,
        code
    )
    .fetch_optional(executor)
    .await
}

pub(crate) async fn claim_database_host_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
) -> Result<Option<DatabaseHostRegistration>, sqlx::Error> {
    query_as!(
        DatabaseHostRegistration,
        r#"DELETE FROM database_host_registrations WHERE code = $1 AND expires_at > now()
           RETURNING code, display, groups, public_host, config AS "config: Json<SetupAgentConfig>",
               EXTRACT(EPOCH FROM expires_at - now())::BIGINT AS "expires_in!""#,
        code
    )
    .fetch_optional(executor)
    .await
}

pub(crate) async fn list_database_host_registrations(
    executor: impl Executor<'_, Database = Postgres> + Copy,
) -> Result<Vec<DatabaseHostRegistration>, sqlx::Error> {
    query!("DELETE FROM database_host_registrations WHERE expires_at <= now()")
        .execute(executor)
        .await?;

    query_as!(
        DatabaseHostRegistration,
        r#"SELECT code, display, groups, public_host, config AS "config: Json<SetupAgentConfig>",
               EXTRACT(EPOCH FROM expires_at - now())::BIGINT AS "expires_in!"
           FROM database_host_registrations ORDER BY expires_at"#
    )
    .fetch_all(executor)
    .await
}

pub(crate) async fn update_database_host_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
    display: &str,
    groups: &[String],
    public_host: &str,
    config: &SetupAgentConfig,
) -> Result<bool, sqlx::Error> {
    Ok(query!(
        "UPDATE database_host_registrations SET display = $2, groups = $3, public_host = $4, config = $5
         WHERE code = $1 AND expires_at > now()",
        code,
        display,
        groups,
        public_host,
        Json(config) as _
    )
    .execute(executor)
    .await?
    .rows_affected()
        > 0)
}

pub(crate) async fn extend_database_host_registration(
    executor: impl Executor<'_, Database = Postgres>,
    code: &str,
) -> Result<bool, sqlx::Error> {
    Ok(query!(
        "UPDATE database_host_registrations SET expires_at = now() + make_interval(secs => $2)
         WHERE code = $1",
        code,
        REGISTRATION_TIMEOUT.as_secs_f64()
    )
    .execute(executor)
    .await?
    .rows_affected()
        > 0)
}
