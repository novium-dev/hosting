use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{
    ManagementPermissions, ProjectPermissions, Role, ServerPermissions,
};
use crate::db::project::ProjectId;
use crate::service::admin::user::user_admin_service_error::{
    DeleteUserError, GetUserError, ListUserProjectsError, ListUsersError, UpdateUserError,
};
use crate::service::*;
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use serde::Serialize;
use sqlx::query;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct AdminUserInfo {
    pub(crate) id: i32,
    pub(crate) username: String,
    pub(crate) auth_id: String,
    pub(crate) role: i32,
    pub(crate) email: String,
    pub(crate) first_name: Option<String>,
    pub(crate) last_name: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct AdminUserProjectInfo {
    pub(crate) id: ProjectId,
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) owner: bool,
    pub(crate) permissions: i64,
    pub(crate) server_count: i64,
}

#[service(path = "/admin/user", tag = "user", no_sdk)]
pub(crate) impl UserAdminService for Backend {
    /// Lists all users.
    #[route("", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_users(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
    ) -> Result<Paged<AdminUserInfo>, _> {
        auth.require::<_, _, ListUsersError>((), ManagementPermissions::USER_VIEW)?;

        Ok(query!(
            r#"SELECT id, username, auth_id, role AS "role: i32", email, first_name, last_name
             FROM users
             ORDER BY id"#
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|user| AdminUserInfo {
            id: user.id,
            username: user.username,
            auth_id: user.auth_id,
            role: user.role,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
        })
        .apply_pagesplit(&mut page)
        .collect_paged(page))
    }

    /// Shows a user.
    #[route("/{user_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::not_found <- [sql:not_found])]
    async fn get_user(
        &self,
        #[special] auth: Authentication,
        user_id: i32,
    ) -> Result<AdminUserInfo, _> {
        auth.require::<_, _, GetUserError>((), ManagementPermissions::USER_VIEW)?;

        let user = query!(
            r#"SELECT id, username, auth_id, role AS "role: i32", email, first_name, last_name
             FROM users
             WHERE id = $1"#,
            user_id
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(AdminUserInfo {
            id: user.id,
            username: user.username,
            auth_id: user.auth_id,
            role: user.role,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
        })
    }

    /// Lists the projects a user owns or is a member of.
    #[route("/{user_id}/projects", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_user_projects(
        &self,
        #[special] auth: Authentication,
        user_id: i32,
    ) -> Result<Vec<AdminUserProjectInfo>, _> {
        auth.require::<_, _, ListUserProjectsError>((), ManagementPermissions::USER_VIEW)?;

        let owner_permissions = ProjectPermissions::all().bits() | ServerPermissions::all().bits();

        Ok(query!(
            r#"SELECT
                projects.id AS "id: ProjectId",
                projects.slug,
                projects.name,
                (projects.owner = $1) AS "owner!",
                COALESCE(project_users.permissions, 0) AS "permissions!",
                (SELECT COUNT(*) FROM servers WHERE servers.project = projects.id) AS "server_count!"
             FROM projects
             LEFT JOIN project_users
                ON project_users.project = projects.id
                AND project_users."user" = $1
             WHERE projects.owner = $1 OR project_users."user" IS NOT NULL
             ORDER BY projects.slug"#,
            user_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|project| AdminUserProjectInfo {
            id: project.id,
            slug: project.slug,
            name: project.name,
            owner: project.owner,
            permissions: if project.owner {
                owner_permissions
            } else {
                project.permissions
            },
            server_count: project.server_count,
        })
        .collect())
    }

    /// Updates a user.
    #[route("/{user_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::not_found <- [sql:not_found])]
    async fn update_user(
        &self,
        #[special] auth: Authentication,
        user_id: i32,
        username: Option<String>,
        auth_id: Option<String>,
        role: Option<u8>,
        email: Option<String>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateUserError>((), ManagementPermissions::USER_MANAGE)?;

        let mut tx = self.database.begin().await?;

        if let Some(username) = username {
            query!(
                "UPDATE users SET username = $1 WHERE id = $2",
                username,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(auth_id) = auth_id {
            query!(
                "UPDATE users SET auth_id = $1 WHERE id = $2",
                auth_id,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(role) = role {
            let role = Role::try_from(role).map_err(|()| UpdateUserError::DbFailure)?;
            query!(
                "UPDATE users SET role = $1 WHERE id = $2",
                role as i32,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(email) = email {
            query!("UPDATE users SET email = $1 WHERE id = $2", email, user_id)
                .execute(&mut *tx)
                .await?;
        }

        query!("SELECT id FROM users WHERE id = $1", user_id)
            .fetch_one(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(())
    }

    /// Deletes a user if they do not own projects.
    #[route("/{user_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::{not_found, owns_project <- [sql:foreign_key]})]
    async fn delete_user(&self, #[special] auth: Authentication, user_id: i32) -> Result<(), _> {
        auth.require::<_, _, DeleteUserError>((), ManagementPermissions::USER_MANAGE)?;

        let result = query!("DELETE FROM users WHERE id = $1", user_id)
            .execute(&*self.database)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DeleteUserError::UserNotFound);
        }

        Ok(())
    }
}
