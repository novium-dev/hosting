use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions};
use crate::auth::user::UserAuthentication;
use crate::db::project::ProjectId;
use crate::service::error_project_not_found::FromProjectNotFound;
use crate::service::error_user_not_found::FromUserNotFound;
use crate::service::project::project_service_error::{
    DeleteProjectError, GetProjectError, ListProjectUsersError, RemoveProjectUserError,
    SetProjectUserError, UpdateProjectError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use serde::Serialize;
use sqlx::{query, query_scalar};
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectInfo {
    pub(crate) id: ProjectId,
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) owner: u32,
    pub(crate) permissions: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectUserInfo {
    pub(crate) id: u32,
    pub(crate) username: String,
    pub(crate) email: String,
    pub(crate) permissions: i64,
}

#[service(path = "/project", tag = "project", no_sdk)]
pub(crate) impl ProjectService for Backend {
    /// Lists projects the current user can access.
    #[route("", method = GET, raw)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn list_projects(
        &self,
        #[special] auth: UserAuthentication,
        #[special] mut page: Option<PageSplit>,
    ) -> Result<Paged<ProjectInfo>, _> {
        let can_manage = auth.has((), ManagementPermissions::SERVER_MANAGE);

        Ok(query!(
            "SELECT
                `projects`.`id` AS `id: ProjectId`,
                `projects`.`slug`,
                `projects`.`name`,
                `projects`.`owner`,
                `project_users`.`permissions`
             FROM `projects`
             LEFT JOIN `project_users`
                ON `project_users`.`project` = `projects`.`id`
                AND `project_users`.`user` = ?
             WHERE ? OR `projects`.`owner` = ? OR `project_users`.`user` IS NOT NULL",
            auth.id,
            can_manage,
            auth.id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|project| {
            let id = project.id;
            ProjectInfo {
                id,
                slug: project.slug,
                name: project.name,
                owner: project.owner,
                permissions: auth.project_permissions(id).bits(),
            }
        })
        .apply_pagesplit(&mut page)
        .collect_paged(page))
    }

    /// Creates a new project owned by the current user.
    #[route("", method = PUT)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn create_project(
        &self,
        #[special] auth: UserAuthentication,
        slug: String,
        name: String,
    ) -> Result<String, _> {
        let id = ProjectId::generate();

        query!(
            "INSERT INTO `projects` (`id`, `slug`, `name`, `owner`) VALUES (?, ?, ?, ?)",
            id,
            slug,
            name,
            auth.id
        )
        .execute(&*self.database)
        .await?;

        Ok(id.to_string())
    }

    /// Shows a project.
    #[route("/{project_id}", method = GET)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found <- [sql:not_found])]
    async fn get_project(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<ProjectInfo, _> {
        auth.require::<_, GetProjectError>(project_id, ProjectPermissions::VIEW)?;

        let project = query!(
            "SELECT `id` AS `id: ProjectId`, `slug`, `name`, `owner`
             FROM `projects`
             WHERE `id` = ?",
            project_id
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(ProjectInfo {
            id: project.id,
            slug: project.slug,
            name: project.name,
            owner: project.owner,
            permissions: auth.project_permissions(project_id).bits(),
        })
    }

    /// Updates project metadata.
    #[route("/{project_id}", method = PATCH)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found <- [sql:not_found], user::not_found <- [sql:foreign_key])]
    async fn update_project(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        slug: Option<String>,
        name: Option<String>,
        owner: Option<u32>,
    ) -> Result<(), _> {
        auth.require::<_, UpdateProjectError>(project_id, ProjectPermissions::ADMIN_MANAGEMENT)?;

        let mut tx = self.database.begin().await?;

        if let Some(owner) = owner {
            query!(
                "UPDATE `projects` SET `owner` = ? WHERE `id` = ?",
                owner,
                project_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(slug) = slug {
            query!(
                "UPDATE `projects` SET `slug` = ? WHERE `id` = ?",
                slug,
                project_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(name) = name {
            query!(
                "UPDATE `projects` SET `name` = ? WHERE `id` = ?",
                name,
                project_id
            )
            .execute(&mut *tx)
            .await?;
        }

        query!(
            "SELECT `id` AS `id: ProjectId` FROM `projects` WHERE `id` = ?",
            project_id
        )
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(())
    }

    /// Deletes an empty project.
    #[route("/{project_id}", method = DELETE)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found, not_empty <- [sql:foreign_key]})]
    async fn delete_project(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<(), _> {
        auth.require::<_, DeleteProjectError>(project_id, ProjectPermissions::ADMIN_MANAGEMENT)?;

        let result = query!("DELETE FROM `projects` WHERE `id` = ?", project_id)
            .execute(&*self.database)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DeleteProjectError::ProjectNotFound);
        }

        Ok(())
    }

    /// Lists project members.
    #[route("/{project_id}/users", method = GET, raw)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found)]
    async fn list_project_users(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
        project_id: ProjectId,
    ) -> Result<Paged<ProjectUserInfo>, _> {
        auth.require::<_, ListProjectUsersError>(project_id, ProjectPermissions::USER_VIEW)?;
        ensure_project_exists::<ListProjectUsersError>(self, project_id).await?;

        Ok(query!(
            "SELECT
                `users`.`id`,
                `users`.`username`,
                `users`.`email`,
                `project_users`.`permissions`
             FROM `project_users`
             JOIN `users` ON `users`.`id` = `project_users`.`user`
            WHERE `project_users`.`project` = ?",
            project_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|user| ProjectUserInfo {
            id: user.id,
            username: user.username,
            email: user.email,
            permissions: user.permissions,
        })
        .apply_pagesplit(&mut page)
        .collect_paged(page))
    }

    /// Sets project permissions for a user.
    #[route("/{project_id}/users/{user_id}", method = PUT)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found, user::not_found <- [sql:foreign_key])]
    async fn set_project_user(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        user_id: u32,
        permissions: i64,
    ) -> Result<(), _> {
        auth.require::<_, SetProjectUserError>(project_id, ProjectPermissions::USER_EDIT)?;
        ensure_project_exists::<SetProjectUserError>(self, project_id).await?;

        query!(
            "INSERT INTO `project_users` (`user`, `project`, `permissions`)
             VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE `permissions` = VALUES(`permissions`)",
            user_id,
            project_id,
            permissions
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }

    /// Removes a project member.
    #[route("/{project_id}/users/{user_id}", method = DELETE)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found)]
    async fn remove_project_user(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        user_id: u32,
    ) -> Result<(), _> {
        auth.require::<_, RemoveProjectUserError>(project_id, ProjectPermissions::USER_EDIT)?;
        ensure_project_exists::<RemoveProjectUserError>(self, project_id).await?;

        query!(
            "DELETE FROM `project_users` WHERE `project` = ? AND `user` = ?",
            project_id,
            user_id
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }
}

pub(crate) async fn ensure_project_exists<E: From<sqlx::Error> + FromProjectNotFound>(
    backend: &Backend,
    project_id: ProjectId,
) -> Result<(), E> {
    let exists = query_scalar!(
        "SELECT (COUNT(*) > 0) AS `exists: bool` FROM `projects` WHERE `id` = ?",
        project_id
    )
    .fetch_one(&*backend.database)
    .await?;

    if exists {
        Ok(())
    } else {
        Err(<E as FromProjectNotFound>::from())
    }
}

pub(crate) async fn ensure_user_exists<E: From<sqlx::Error> + FromUserNotFound>(
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
        Err(<E as FromUserNotFound>::from())
    }
}
