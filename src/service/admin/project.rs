use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::service::admin::project::project_admin_service_error::{
    CreateProjectError, DeleteProjectError, GetProjectError, ListProjectsError, UpdateProjectError,
};
use crate::service::project::{ProjectInfo, ProjectUpdate};
use crate::service::*;
use serde::Deserialize;
use sqlx::{query, query_scalar};
use uuid::Uuid;
use zelus::service;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct AdminProjectCreate {
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) owner: u32,
}

#[service(path = "/admin/project", tag = "project", no_sdk)]
pub(crate) impl ProjectAdminService for Backend {
    /// Lists all projects.
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_projects(&self, #[special] auth: Authentication) -> Result<Vec<ProjectInfo>, _> {
        auth.require::<_, ListProjectsError>((), ManagementPermissions::SERVER_MANAGE)?;

        Ok(query!(
            "SELECT `id` AS `id: uuid::fmt::Hyphenated`, `slug`, `name`, `owner`
             FROM `projects`
             ORDER BY `slug`"
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|project| ProjectInfo {
            id: project.id.into_uuid(),
            slug: project.slug,
            name: project.name,
            owner: project.owner,
            permissions: 0,
        })
        .collect())
    }

    /// Creates a project for any owner.
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::not_found)]
    async fn create_project(
        &self,
        #[special] auth: Authentication,
        project: AdminProjectCreate,
    ) -> Result<String, _> {
        auth.require::<_, CreateProjectError>((), ManagementPermissions::SERVER_MANAGE)?;
        ensure_user_exists::<CreateProjectError>(self, project.owner).await?;

        let id = Uuid::new_v4();
        query!(
            "INSERT INTO `projects` (`id`, `slug`, `name`, `owner`) VALUES (?, ?, ?, ?)",
            &id,
            project.slug,
            project.name,
            project.owner
        )
        .execute(&*self.database)
        .await?;

        Ok(id.to_string())
    }

    /// Shows any project.
    #[route("/{project_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], project::not_found)]
    async fn get_project(
        &self,
        #[special] auth: Authentication,
        #[no_schema] project_id: Uuid,
    ) -> Result<ProjectInfo, _> {
        auth.require::<_, GetProjectError>((), ManagementPermissions::SERVER_MANAGE)?;

        let project = query!(
            "SELECT `id` AS `id: uuid::fmt::Hyphenated`, `slug`, `name`, `owner`
             FROM `projects`
             WHERE `id` = ?",
            &project_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(GetProjectError::ProjectNotFound)?;

        Ok(ProjectInfo {
            id: project.id.into_uuid(),
            slug: project.slug,
            name: project.name,
            owner: project.owner,
            permissions: 0,
        })
    }

    /// Updates any project.
    #[route("/{project_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], project::not_found, user::not_found)]
    async fn update_project(
        &self,
        #[special] auth: Authentication,
        #[no_schema] project_id: Uuid,
        update: ProjectUpdate,
    ) -> Result<(), _> {
        auth.require::<_, UpdateProjectError>((), ManagementPermissions::SERVER_MANAGE)?;
        ensure_project_exists::<UpdateProjectError>(self, project_id).await?;

        if let Some(owner) = update.owner {
            ensure_user_exists::<UpdateProjectError>(self, owner).await?;
            query!(
                "UPDATE `projects` SET `owner` = ? WHERE `id` = ?",
                owner,
                &project_id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(slug) = update.slug {
            query!(
                "UPDATE `projects` SET `slug` = ? WHERE `id` = ?",
                slug,
                &project_id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(name) = update.name {
            query!(
                "UPDATE `projects` SET `name` = ? WHERE `id` = ?",
                name,
                &project_id
            )
            .execute(&*self.database)
            .await?;
        }

        Ok(())
    }

    /// Deletes a project if it has no servers.
    #[route("/{project_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], project::{not_found, not_empty})]
    async fn delete_project(
        &self,
        #[special] auth: Authentication,
        #[no_schema] project_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, DeleteProjectError>((), ManagementPermissions::SERVER_MANAGE)?;
        ensure_project_exists::<DeleteProjectError>(self, project_id).await?;

        let server_count = query_scalar!(
            "SELECT COUNT(*) AS `count` FROM `servers` WHERE `project` = ?",
            &project_id
        )
        .fetch_one(&*self.database)
        .await?;

        if server_count > 0 {
            return Err(DeleteProjectError::ProjectNotEmpty);
        }

        query!("DELETE FROM `projects` WHERE `id` = ?", &project_id)
            .execute(&*self.database)
            .await?;

        Ok(())
    }
}

async fn ensure_project_exists<
    E: From<sqlx::Error> + crate::service::error_project_not_found::FromProjectNotFound,
>(
    backend: &Backend,
    project_id: Uuid,
) -> Result<(), E> {
    let exists = query_scalar!(
        "SELECT (COUNT(*) > 0) AS `exists: bool` FROM `projects` WHERE `id` = ?",
        &project_id
    )
    .fetch_one(&*backend.database)
    .await?;

    if exists {
        Ok(())
    } else {
        Err(<E as crate::service::error_project_not_found::FromProjectNotFound>::from())
    }
}

async fn ensure_user_exists<
    E: From<sqlx::Error> + crate::service::error_user_not_found::FromUserNotFound,
>(
    backend: &Backend,
    user_id: u32,
) -> Result<(), E> {
    let exists = query_scalar!(
        "SELECT (COUNT(*) > 0) AS `exists: bool` FROM `users` WHERE `id` = ?",
        user_id
    )
    .fetch_one(&*backend.database)
    .await?;

    if exists {
        Ok(())
    } else {
        Err(<E as crate::service::error_user_not_found::FromUserNotFound>::from())
    }
}
