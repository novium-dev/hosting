use crate::Backend;
use crate::auth::Authentication;
use crate::auth::grant::resolve_grant;
use crate::auth::permissions::ManagementPermissions;
use crate::db::project::ProjectId;
use crate::service::admin::api_key::api_key_admin_service_error::{
    DeleteAnyApiKeyError, ListAllApiKeysError,
};
use crate::service::api_key::{ApiKeyInfo, error_api_key_not_found, variable_path_api_key_id};
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
                api_keys.known_permissions,
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
            permissions: resolve_grant(key.permissions, key.known_permissions),
            user: key.user,
            username: key.username,
            created_at: key.created_at.timestamp(),
            last_used: key.last_used.map(|last_used| last_used.timestamp()),
        })
        .apply_pagesplit(&mut page)
        .collect_paged(page))
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
