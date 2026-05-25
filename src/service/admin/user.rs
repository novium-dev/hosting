use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, Role};
use crate::service::admin::user::user_admin_service_error::{
    DeleteUserError, GetUserError, ListUsersError, UpdateUserError,
};
use crate::service::*;
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use serde::Serialize;
use sqlx::query;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct AdminUserInfo {
    pub(crate) id: u32,
    pub(crate) username: String,
    pub(crate) auth_id: String,
    pub(crate) role: u8,
    pub(crate) email: String,
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
            "SELECT `id`, `username`, `auth_id`, `role` AS `role: u8`, `email`
             FROM `users`
             ORDER BY `id`"
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
        user_id: u32,
    ) -> Result<AdminUserInfo, _> {
        auth.require::<_, _, GetUserError>((), ManagementPermissions::USER_VIEW)?;

        let user = query!(
            "SELECT `id`, `username`, `auth_id`, `role` AS `role: u8`, `email`
             FROM `users`
             WHERE `id` = ?",
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
        })
    }

    /// Updates a user.
    #[route("/{user_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::not_found <- [sql:not_found])]
    async fn update_user(
        &self,
        #[special] auth: Authentication,
        user_id: u32,
        username: Option<String>,
        auth_id: Option<String>,
        role: Option<u8>,
        email: Option<String>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateUserError>((), ManagementPermissions::USER_MANAGE)?;

        let mut tx = self.database.begin().await?;

        if let Some(username) = username {
            query!(
                "UPDATE `users` SET `username` = ? WHERE `id` = ?",
                username,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(auth_id) = auth_id {
            query!(
                "UPDATE `users` SET `auth_id` = ? WHERE `id` = ?",
                auth_id,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(role) = role {
            let role = Role::try_from(role).map_err(|()| UpdateUserError::DbFailure)?;
            query!(
                "UPDATE `users` SET `role` = ? WHERE `id` = ?",
                role as u8,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(email) = email {
            query!(
                "UPDATE `users` SET `email` = ? WHERE `id` = ?",
                email,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        query!("SELECT `id` FROM `users` WHERE `id` = ?", user_id)
            .fetch_one(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(())
    }

    /// Deletes a user if they do not own projects.
    #[route("/{user_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::{not_found, owns_project <- [sql:foreign_key]})]
    async fn delete_user(&self, #[special] auth: Authentication, user_id: u32) -> Result<(), _> {
        auth.require::<_, _, DeleteUserError>((), ManagementPermissions::USER_MANAGE)?;

        let result = query!("DELETE FROM `users` WHERE `id` = ?", user_id)
            .execute(&*self.database)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DeleteUserError::UserNotFound);
        }

        Ok(())
    }
}
