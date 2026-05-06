use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, Role};
use crate::service::admin::user::user_admin_service_error::{
    CreateUserError, DeleteUserError, GetUserError, ListUsersError, UpdateUserError,
};
use crate::service::*;
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct AdminUserInfo {
    pub(crate) id: u32,
    pub(crate) username: String,
    pub(crate) auth_id: String,
    pub(crate) role: u8,
    pub(crate) email: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateUser {
    pub(crate) username: String,
    pub(crate) auth_id: String,
    pub(crate) role: u8,
    pub(crate) email: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct UpdateUser {
    pub(crate) username: Option<String>,
    pub(crate) auth_id: Option<String>,
    pub(crate) role: Option<u8>,
    pub(crate) email: Option<String>,
}

#[service(path = "/admin/user", tag = "user", no_sdk)]
pub(crate) impl UserAdminService for Backend {
    /// Lists all users.
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_users(&self, #[special] auth: Authentication) -> Result<Vec<AdminUserInfo>, _> {
        auth.require::<_, ListUsersError>((), ManagementPermissions::USER_VIEW)?;

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
        .collect())
    }

    /// Shows a user.
    #[route("/{user_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::not_found)]
    async fn get_user(
        &self,
        #[special] auth: Authentication,
        user_id: u32,
    ) -> Result<AdminUserInfo, _> {
        auth.require::<_, GetUserError>((), ManagementPermissions::USER_VIEW)?;

        let user = query!(
            "SELECT `id`, `username`, `auth_id`, `role` AS `role: u8`, `email`
             FROM `users`
             WHERE `id` = ?",
            user_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(GetUserError::UserNotFound)?;

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
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::not_found)]
    async fn update_user(
        &self,
        #[special] auth: Authentication,
        user_id: u32,
        update: UpdateUser,
    ) -> Result<(), _> {
        auth.require::<_, UpdateUserError>((), ManagementPermissions::USER_MANAGE)?;
        ensure_user_exists::<UpdateUserError>(self, user_id).await?;

        if let Some(username) = update.username {
            query!(
                "UPDATE `users` SET `username` = ? WHERE `id` = ?",
                username,
                user_id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(auth_id) = update.auth_id {
            query!(
                "UPDATE `users` SET `auth_id` = ? WHERE `id` = ?",
                auth_id,
                user_id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(role) = update.role {
            let role = Role::try_from(role).map_err(|()| UpdateUserError::DbFailure)?;
            query!(
                "UPDATE `users` SET `role` = ? WHERE `id` = ?",
                role as u8,
                user_id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(email) = update.email {
            query!(
                "UPDATE `users` SET `email` = ? WHERE `id` = ?",
                email,
                user_id
            )
            .execute(&*self.database)
            .await?;
        }

        Ok(())
    }

    /// Deletes a user if they do not own projects.
    #[route("/{user_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], user::{not_found, owns_project})]
    async fn delete_user(&self, #[special] auth: Authentication, user_id: u32) -> Result<(), _> {
        auth.require::<_, DeleteUserError>((), ManagementPermissions::USER_MANAGE)?;
        ensure_user_exists::<DeleteUserError>(self, user_id).await?;

        let owns_projects = query_scalar!(
            "SELECT (COUNT(*) > 0) AS `exists: bool` FROM `projects` WHERE `owner` = ?",
            user_id
        )
        .fetch_one(&*self.database)
        .await?;

        if owns_projects {
            return Err(DeleteUserError::UserOwnsProject);
        }

        query!("DELETE FROM `users` WHERE `id` = ?", user_id)
            .execute(&*self.database)
            .await?;

        Ok(())
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
