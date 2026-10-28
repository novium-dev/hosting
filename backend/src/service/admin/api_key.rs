use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::project::ProjectId;
use crate::service::admin::api_key::api_key_admin_service_error::{
    DeleteAnyApiKeyError, ListAllApiKeysError, UpdateAnyApiKeyError,
};
use crate::service::api_key::{
    ApiKeyInfo, error_api_key_not_found, error_api_key_permissions_exceeded, grant_ceiling,
    grantable_permissions, variable_path_api_key_id,
};
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::*;
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use sqlx::query;
use zelus::service;

#[service(path = "/admin/api-key", tag = "api_key", no_sdk)]
pub(crate) impl ApiKeyAdminService for Backend {
    /// Lists every API key on this instance.
    ///
    /// Tokens are never included — a key's token exists in the clear only once,
    /// when it is created.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::API_KEYS_VIEW`.
    #[route("", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_all_api_keys(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
    ) -> Result<Paged<ApiKeyInfo>, _> {
        auth.require::<_, _, ListAllApiKeysError>((), ManagementPermissions::API_KEYS_VIEW)?;

        Ok(query!(
            r#"SELECT
                api_keys.id,
                api_keys.name,
                api_keys.token_prefix,
                api_keys.project AS "project: ProjectId",
                projects.slug AS "project_slug?",
                api_keys.permissions,
                api_keys."user",
                users.username,
                api_keys.created_at,
                api_keys.last_used
             FROM api_keys
             JOIN users ON users.id = api_keys."user"
             LEFT JOIN projects ON projects.id = api_keys.project
             ORDER BY api_keys.id"#
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|key| ApiKeyInfo {
            id: key.id,
            name: key.name,
            prefix: key.token_prefix,
            project: key.project,
            project_slug: key.project_slug,
            permissions: key.permissions,
            user: key.user,
            username: key.username,
            created_at: key.created_at.timestamp(),
            last_used: key.last_used.map(|last_used| last_used.timestamp()),
        })
        .apply_pagesplit(&mut page)
        .collect_paged(page))
    }

    /// Renames any API key on this instance or changes its permissions.
    ///
    /// The scope (project or instance-wide) is fixed at creation.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::API_KEYS_MANAGE`. Both the key's current
    /// permissions and the new ones may never exceed your own.
    #[route("/{api_key_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], api_key::{not_found, permissions_exceeded})]
    async fn update_any_api_key(
        &self,
        #[special] auth: Authentication,
        api_key_id: i32,
        name: Option<String>,
        permissions: Option<i64>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateAnyApiKeyError>((), ManagementPermissions::API_KEYS_MANAGE)?;
        let access = auth
            .access()
            .ok_or_else(<UpdateAnyApiKeyError as FromAuthPermissionDenied>::from)?;

        let key = query!(
            r#"SELECT project AS "project: ProjectId", permissions FROM api_keys WHERE id = $1"#,
            api_key_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(UpdateAnyApiKeyError::ApiKeyNotFound)?;

        if key.permissions & !grant_ceiling(access, key.project) != 0 {
            return Err(<UpdateAnyApiKeyError as FromAuthPermissionDenied>::from());
        }

        if let Some(permissions) = permissions {
            let permissions =
                grantable_permissions::<UpdateAnyApiKeyError>(access, key.project, permissions)?;

            query!(
                "UPDATE api_keys SET permissions = $1 WHERE id = $2",
                permissions,
                api_key_id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(name) = name {
            query!(
                "UPDATE api_keys SET name = $1 WHERE id = $2",
                name,
                api_key_id
            )
            .execute(&*self.database)
            .await?;
        }

        Ok(())
    }

    /// Deletes any API key on this instance, revoking it immediately.
    ///
    /// # Permissions
    /// Requires `ManagementPermissions::API_KEYS_MANAGE`.
    #[route("/{api_key_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], api_key::not_found)]
    async fn delete_any_api_key(
        &self,
        #[special] auth: Authentication,
        api_key_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteAnyApiKeyError>((), ManagementPermissions::API_KEYS_MANAGE)?;

        let result = query!("DELETE FROM api_keys WHERE id = $1", api_key_id)
            .execute(&*self.database)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DeleteAnyApiKeyError::ApiKeyNotFound);
        }

        Ok(())
    }
}
