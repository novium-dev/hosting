use serde::Serialize;
use sqlx::{PgPool, query, query_as};

use crate::db::server::ServerId;
use crate::resources::{ResourceProvider, ResourceType};

/// One installed mod/plugin, as stored in `server_resources`.
///
/// Keyed by `(server, provider, project)`, so a server holds at most one
/// version of any given project and re-installing is an upsert.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct InstalledResource {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) resource_type: ResourceType,
    pub(crate) file_name: String,
    pub(crate) title: String,
    /// Unix seconds.
    pub(crate) installed_at: i64,
}

struct InstalledRecord {
    provider: String,
    project: String,
    version: String,
    resource_type: String,
    file_name: String,
    title: String,
    installed_at: chrono::DateTime<chrono::Utc>,
}

impl InstalledRecord {
    /// Rows written by an older or newer build could name a provider or type
    /// this binary does not know; those are skipped rather than failing the
    /// whole listing.
    fn into_resource(self) -> Option<InstalledResource> {
        Some(InstalledResource {
            provider: serde_json::from_value(serde_json::Value::String(self.provider)).ok()?,
            project: self.project,
            version: self.version,
            resource_type: ResourceType::from_str(&self.resource_type)?,
            file_name: self.file_name,
            title: self.title,
            installed_at: self.installed_at.timestamp(),
        })
    }
}

pub(crate) async fn list_installed(
    database: &PgPool,
    server: ServerId,
) -> Result<Vec<InstalledResource>, sqlx::Error> {
    Ok(query_as!(
        InstalledRecord,
        r#"SELECT provider, project, version, resource_type, file_name, title, installed_at
           FROM server_resources
           WHERE server = $1
           ORDER BY title"#,
        server as ServerId
    )
    .fetch_all(database)
    .await?
    .into_iter()
    .filter_map(InstalledRecord::into_resource)
    .collect())
}

/// The file currently installed for `(server, provider, project)`, if any.
///
/// Used to delete the previous jar when switching versions; without it a
/// version switch would leave both jars in place and the server would refuse to
/// start on the duplicate plugin.
pub(crate) async fn installed_file(
    database: &PgPool,
    server: ServerId,
    provider: ResourceProvider,
    project: &str,
) -> Result<Option<(String, ResourceType)>, sqlx::Error> {
    Ok(query!(
        r#"SELECT file_name, resource_type
           FROM server_resources
           WHERE server = $1 AND provider = $2 AND project = $3"#,
        server as ServerId,
        provider.as_str(),
        project
    )
    .fetch_optional(database)
    .await?
    .and_then(|record| {
        ResourceType::from_str(&record.resource_type)
            .map(|resource_type| (record.file_name, resource_type))
    }))
}

pub(crate) async fn upsert_installed(
    database: &PgPool,
    server: ServerId,
    provider: ResourceProvider,
    project: &str,
    version: &str,
    resource_type: ResourceType,
    file_name: &str,
    title: &str,
) -> Result<(), sqlx::Error> {
    query!(
        r#"INSERT INTO server_resources
               (server, provider, project, version, resource_type, file_name, title)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (server, provider, project) DO UPDATE SET
               version = excluded.version,
               resource_type = excluded.resource_type,
               file_name = excluded.file_name,
               title = excluded.title,
               installed_at = now()"#,
        server as ServerId,
        provider.as_str(),
        project,
        version,
        resource_type.as_str(),
        file_name,
        title
    )
    .execute(database)
    .await?;

    Ok(())
}

pub(crate) async fn delete_installed(
    database: &PgPool,
    server: ServerId,
    provider: ResourceProvider,
    project: &str,
) -> Result<bool, sqlx::Error> {
    Ok(query!(
        r#"DELETE FROM server_resources
           WHERE server = $1 AND provider = $2 AND project = $3"#,
        server as ServerId,
        provider.as_str(),
        project
    )
    .execute(database)
    .await?
    .rows_affected()
        > 0)
}
