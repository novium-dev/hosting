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
    /// The base (active) name, which is what install writes. The on-disk file
    /// may carry a `.disabled` suffix; see `enabled`.
    pub(crate) file_name: String,
    pub(crate) title: String,
    /// Whether the file is active on disk. Not stored — the `.disabled` suffix
    /// on the file *is* this state, so it is resolved from the directory listing
    /// during reconciliation and can never drift from reality.
    pub(crate) enabled: bool,
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
            provider: ResourceProvider::parse_str(&self.provider)?,
            project: self.project,
            version: self.version,
            resource_type: ResourceType::parse_str(&self.resource_type)?,
            file_name: self.file_name,
            title: self.title,
            // Assumed active until a directory listing says otherwise.
            enabled: true,
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
        ResourceType::parse_str(&record.resource_type)
            .map(|resource_type| (record.file_name, resource_type))
    }))
}

/// Records `resource` as installed, replacing whatever was recorded for the
/// same `(server, provider, project)`.
pub(crate) async fn upsert_installed(
    database: &PgPool,
    server: ServerId,
    resource: &InstalledResource,
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
        resource.provider.as_str(),
        resource.project,
        resource.version,
        resource.resource_type.as_str(),
        resource.file_name,
        resource.title
    )
    .execute(database)
    .await?;

    Ok(())
}

/// Drops the records for `file_names`, used when a reconciliation finds that
/// those files are no longer on disk.
pub(crate) async fn delete_installed_files(
    database: &PgPool,
    server: ServerId,
    file_names: &[String],
) -> Result<u64, sqlx::Error> {
    Ok(query!(
        r#"DELETE FROM server_resources
           WHERE server = $1 AND file_name = ANY($2)"#,
        server as ServerId,
        file_names
    )
    .execute(database)
    .await?
    .rows_affected())
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

/// The modpack installed on a server, with the files it wrote.
///
/// Kept apart from `server_resources`: a pack's mods are not individually
/// managed — updating one mod out from under a pack would break its coherence —
/// but they still need attributing to the pack rather than showing up as files
/// nobody owns.
#[derive(Debug, Clone)]
pub(crate) struct ModpackRecord {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) title: String,
    /// Server-relative paths the pack installed, e.g. `mods/sodium.jar`.
    pub(crate) files: Vec<String>,
    /// Unix seconds.
    pub(crate) installed_at: i64,
}

pub(crate) async fn get_modpack(
    database: &PgPool,
    server: ServerId,
) -> Result<Option<ModpackRecord>, sqlx::Error> {
    Ok(query!(
        r#"SELECT provider, project, version, title, files, installed_at
           FROM server_modpacks
           WHERE server = $1"#,
        server as ServerId
    )
    .fetch_optional(database)
    .await?
    .and_then(|record| {
        Some(ModpackRecord {
            // A provider this build does not know is skipped, same as for
            // installed resources.
            provider: ResourceProvider::parse_str(&record.provider)?,
            project: record.project,
            version: record.version,
            title: record.title,
            files: record.files,
            installed_at: record.installed_at.timestamp(),
        })
    }))
}

pub(crate) async fn upsert_modpack(
    database: &PgPool,
    server: ServerId,
    modpack: &ModpackRecord,
) -> Result<(), sqlx::Error> {
    query!(
        r#"INSERT INTO server_modpacks (server, provider, project, version, title, files)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (server) DO UPDATE SET
               provider = excluded.provider,
               project = excluded.project,
               version = excluded.version,
               title = excluded.title,
               files = excluded.files,
               installed_at = now()"#,
        server as ServerId,
        modpack.provider.as_str(),
        modpack.project,
        modpack.version,
        modpack.title,
        &modpack.files
    )
    .execute(database)
    .await?;

    Ok(())
}

pub(crate) async fn delete_modpack(database: &PgPool, server: ServerId) -> Result<(), sqlx::Error> {
    query!(
        "DELETE FROM server_modpacks WHERE server = $1",
        server as ServerId
    )
    .execute(database)
    .await?;

    Ok(())
}
