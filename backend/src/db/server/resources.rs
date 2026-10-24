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
    pub(crate) page_url: Option<String>,
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
    page_url: Option<String>,
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
            page_url: self.page_url,
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
        r#"SELECT provider, project, version, resource_type, file_name, title, page_url,
                  installed_at
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
               (server, provider, project, version, resource_type, file_name, title, page_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (server, provider, project) DO UPDATE SET
               version = excluded.version,
               resource_type = excluded.resource_type,
               file_name = excluded.file_name,
               title = excluded.title,
               page_url = excluded.page_url,
               installed_at = now()"#,
        server as ServerId,
        resource.provider.as_str(),
        resource.project,
        resource.version,
        resource.resource_type.as_str(),
        resource.file_name,
        resource.title,
        resource.page_url
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

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ModpackFileRecord {
    pub(crate) path: String,
    pub(crate) project: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) icon_url: Option<String>,
    pub(crate) page_url: Option<String>,
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
    pub(crate) game_version: Option<String>,
    pub(crate) loader_version: Option<String>,
    pub(crate) files: Vec<ModpackFileRecord>,
    pub(crate) installed_at: i64,
}

pub(crate) async fn get_modpack(
    database: &PgPool,
    server: ServerId,
) -> Result<Option<ModpackRecord>, sqlx::Error> {
    let Some(record) = query!(
        r#"SELECT provider, project, version, version_number, loader, title,
                  icon_url, page_url, game_version, loader_version, installed_at
           FROM server_modpacks
           WHERE server = $1"#,
        server as ServerId
    )
    .fetch_optional(database)
    .await?
    else {
        return Ok(None);
    };

    let Some(provider) = ResourceProvider::parse_str(&record.provider) else {
        return Ok(None);
    };

    let files = query_as!(
        ModpackFileRecord,
        r#"SELECT path, project, version, title, icon_url, page_url
           FROM server_modpack_files
           WHERE server = $1
           ORDER BY path"#,
        server as ServerId
    )
    .fetch_all(database)
    .await?;

    Ok(Some(ModpackRecord {
        provider,
        project: record.project,
        version: record.version,
        version_number: record.version_number,
        loader: record.loader.as_deref().and_then(ResourceLoader::parse_str),
        title: record.title,
        icon_url: record.icon_url,
        page_url: record.page_url,
        game_version: record.game_version,
        loader_version: record.loader_version,
        files,
        installed_at: record.installed_at.timestamp(),
    }))
}

pub(crate) async fn replace_modpack(
    database: &PgPool,
    server: ServerId,
    modpack: &ModpackRecord,
) -> Result<(), sqlx::Error> {
    let mut tx = database.begin().await?;

    query!(
        r#"INSERT INTO server_modpacks
               (server, provider, project, version, version_number, loader, title,
                icon_url, page_url, game_version, loader_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (server) DO UPDATE SET
               provider = excluded.provider,
               project = excluded.project,
               version = excluded.version,
               version_number = excluded.version_number,
               loader = excluded.loader,
               title = excluded.title,
               icon_url = excluded.icon_url,
               page_url = excluded.page_url,
               game_version = excluded.game_version,
               loader_version = excluded.loader_version,
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
        modpack.game_version,
        modpack.loader_version
    )
    .execute(&mut *tx)
    .await?;

    query!(
        "DELETE FROM server_modpack_files WHERE server = $1",
        server as ServerId
    )
    .execute(&mut *tx)
    .await?;

    let mut paths = Vec::with_capacity(modpack.files.len());
    let mut projects = Vec::with_capacity(modpack.files.len());
    let mut versions = Vec::with_capacity(modpack.files.len());
    let mut titles = Vec::with_capacity(modpack.files.len());
    let mut icons = Vec::with_capacity(modpack.files.len());
    let mut pages = Vec::with_capacity(modpack.files.len());
    for file in &modpack.files {
        paths.push(file.path.clone());
        projects.push(file.project.clone());
        versions.push(file.version.clone());
        titles.push(file.title.clone());
        icons.push(file.icon_url.clone());
        pages.push(file.page_url.clone());
    }

    query!(
        r#"INSERT INTO server_modpack_files
               (server, path, project, version, title, icon_url, page_url)
           SELECT $1, *
           FROM UNNEST($2::text[], $3::varchar[], $4::varchar[], $5::varchar[],
                       $6::text[], $7::text[])
           ON CONFLICT DO NOTHING"#,
        server as ServerId,
        &paths,
        &projects as &[Option<String>],
        &versions as &[Option<String>],
        &titles as &[Option<String>],
        &icons as &[Option<String>],
        &pages as &[Option<String>]
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await
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
