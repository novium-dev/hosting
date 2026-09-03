use serde::Serialize;
use sqlx::{PgPool, query, query_as};

use crate::db::server::ServerId;
use crate::resources::{ResourceLoader, ResourceProvider, ResourceType};

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct InstalledResource {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) resource_type: ResourceType,
    pub(crate) file_name: String,
    pub(crate) title: String,
    pub(crate) enabled: bool,
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
    fn into_resource(self) -> Option<InstalledResource> {
        Some(InstalledResource {
            provider: ResourceProvider::parse_str(&self.provider)?,
            project: self.project,
            version: self.version,
            resource_type: ResourceType::parse_str(&self.resource_type)?,
            file_name: self.file_name,
            title: self.title,
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

#[derive(Debug, Clone)]
pub(crate) struct ModpackRecord {
    pub(crate) provider: ResourceProvider,
    pub(crate) project: String,
    pub(crate) version: String,
    pub(crate) version_number: Option<String>,
    pub(crate) loader: Option<ResourceLoader>,
    pub(crate) title: String,
    pub(crate) icon_url: Option<String>,
    pub(crate) page_url: Option<String>,
    pub(crate) files: Vec<String>,
    pub(crate) installed_at: i64,
}

pub(crate) async fn get_modpack(
    database: &PgPool,
    server: ServerId,
) -> Result<Option<ModpackRecord>, sqlx::Error> {
    Ok(query!(
        r#"SELECT provider, project, version, version_number, loader, title,
                  icon_url, page_url, files, installed_at
           FROM server_modpacks
           WHERE server = $1"#,
        server as ServerId
    )
    .fetch_optional(database)
    .await?
    .and_then(|record| {
        Some(ModpackRecord {
            provider: ResourceProvider::parse_str(&record.provider)?,
            project: record.project,
            version: record.version,
            version_number: record.version_number,
            loader: record.loader.as_deref().and_then(ResourceLoader::parse_str),
            title: record.title,
            icon_url: record.icon_url,
            page_url: record.page_url,
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
        r#"INSERT INTO server_modpacks
               (server, provider, project, version, version_number, loader, title,
                icon_url, page_url, files)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (server) DO UPDATE SET
               provider = excluded.provider,
               project = excluded.project,
               version = excluded.version,
               version_number = excluded.version_number,
               loader = excluded.loader,
               title = excluded.title,
               icon_url = excluded.icon_url,
               page_url = excluded.page_url,
               files = excluded.files,
               installed_at = now()"#,
        server as ServerId,
        modpack.provider.as_str(),
        modpack.project,
        modpack.version,
        modpack.version_number,
        modpack.loader.map(ResourceLoader::as_str),
        modpack.title,
        modpack.icon_url,
        modpack.page_url,
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
