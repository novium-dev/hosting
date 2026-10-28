use super::*;
use crate::Backend;
use crate::auth::api_key::ApiKeyToken;
use crate::auth::effective::EffectivePermissions;
use crate::auth::permissions::{
    ManagementPermissions, PermissionSet as _, ProjectPermissions, ServerPermissions,
};
use crate::auth::user::UserAuthentication;
use crate::db::project::ProjectId;
use crate::service::api_key::api_key_service_error::{
    CreateApiKeyError, DeleteApiKeyError, ListProjectApiKeysError, UpdateApiKeyError,
};
use crate::service::api_key::error_api_key_permissions_exceeded::FromApiKeyPermissionsExceeded;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_project_not_found::FromProjectNotFound;
use serde::Serialize;
use sqlx::query;
use zelus::{define_path_variable, service};

define_path_variable!(api_key_id "The API key ID");

define_error!(api_key {
    not_found("API key not found" NOT_FOUND),
    permissions_exceeded("An API key cannot be granted permissions you do not hold yourself" BAD_REQUEST),
});

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ApiKeyInfo {
    pub(crate) id: i32,
    pub(crate) name: String,
    pub(crate) prefix: String,
    pub(crate) project: Option<ProjectId>,
    pub(crate) project_slug: Option<String>,
    pub(crate) permissions: i64,
    pub(crate) user: i32,
    pub(crate) username: String,
    pub(crate) created_at: i64,
    pub(crate) last_used: Option<i64>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct CreatedApiKey {
    pub(crate) id: i32,
    pub(crate) key: String,
}

#[service(path = "/api-key", tag = "api_key", no_sdk)]
pub(crate) impl ApiKeyService for Backend {
    /// Lists the current user's API keys.
    ///
    /// Both project-scoped and instance-wide keys are listed. Tokens are never
    /// included — only the prefix that identifies them.
    #[route("", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn list_api_keys(
        &self,
        #[special] auth: UserAuthentication,
    ) -> Result<Vec<ApiKeyInfo>, _> {
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
             WHERE api_keys."user" = $1
             ORDER BY api_keys.id"#,
            auth.id
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
        .collect())
    }

    /// Lists the API keys scoped to a project.
    ///
    /// # Permissions
    /// Requires `ProjectPermissions::VIEW`, which lists your own keys.
    /// Requires `ProjectPermissions::ADMIN_MANAGEMENT` to also see the keys
    /// other members created for this project.
    #[route("/project/{project_id}", method = GET)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found)]
    async fn list_project_api_keys(
        &self,
        #[special] auth: UserAuthentication,
        project_id: ProjectId,
    ) -> Result<Vec<ApiKeyInfo>, _> {
        auth.require::<_, _, ListProjectApiKeysError>(project_id, ProjectPermissions::VIEW)?;

        let all = auth
            .require::<_, _, ListProjectApiKeysError>(
                project_id,
                ProjectPermissions::ADMIN_MANAGEMENT,
            )
            .is_ok();

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
             WHERE api_keys.project = $1
               AND (api_keys."user" = $2 OR $3)
             ORDER BY api_keys.id"#,
            &project_id,
            auth.id,
            all
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
        .collect())
    }

    /// Creates an API key and returns its token.
    ///
    /// The token is shown once and only its hash is stored. A key acts as its
    /// creator: its permissions are re-derived from them on every request, so it
    /// can never do more than they can at that moment.
    ///
    /// # Permissions
    /// Requires `ProjectPermissions::VIEW` on the project a key is scoped to.
    /// Requires `ManagementPermissions::API_KEYS_MANAGE` for an instance-wide
    /// key (`project` omitted).
    /// The requested permissions may never exceed your own.
    #[route("", method = PUT)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found <- [sql:foreign_key], api_key::permissions_exceeded)]
    async fn create_api_key(
        &self,
        #[special] auth: UserAuthentication,
        name: String,
        project: Option<ProjectId>,
        permissions: i64,
    ) -> Result<CreatedApiKey, _> {
        ensure_scope_access::<CreateApiKeyError>(&auth, project)?;
        let permissions = grantable_permissions::<CreateApiKeyError>(&auth, project, permissions)?;

        let token = ApiKeyToken::generate();
        let record = query!(
            r#"INSERT INTO api_keys
                (name, token_hash, token_prefix, "user", project, permissions)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id"#,
            name,
            token.hash(),
            token.display_prefix(),
            auth.id,
            project.as_ref().map(|project| project.as_str()),
            permissions
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(CreatedApiKey {
            id: record.id,
            key: token.to_string(),
        })
    }

    /// Renames an API key or changes its permissions.
    ///
    /// The scope (project or instance-wide) is fixed at creation.
    ///
    /// # Permissions
    /// The permissions may never exceed your own.
    #[route("/{api_key_id}", method = PATCH)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found, api_key::{not_found, permissions_exceeded})]
    async fn update_api_key(
        &self,
        #[special] auth: UserAuthentication,
        api_key_id: i32,
        name: Option<String>,
        permissions: Option<i64>,
    ) -> Result<(), _> {
        let Some(key) = query!(
            r#"SELECT project AS "project: ProjectId" FROM api_keys WHERE id = $1 AND "user" = $2"#,
            api_key_id,
            auth.id
        )
        .fetch_optional(&*self.database)
        .await?
        else {
            return Err(UpdateApiKeyError::ApiKeyNotFound);
        };

        if let Some(permissions) = permissions {
            ensure_scope_access::<UpdateApiKeyError>(&auth, key.project)?;
            let permissions =
                grantable_permissions::<UpdateApiKeyError>(&auth, key.project, permissions)?;

            query!(
                r#"UPDATE api_keys SET permissions = $1 WHERE id = $2 AND "user" = $3"#,
                permissions,
                api_key_id,
                auth.id
            )
            .execute(&*self.database)
            .await?;
        }

        if let Some(name) = name {
            query!(
                r#"UPDATE api_keys SET name = $1 WHERE id = $2 AND "user" = $3"#,
                name,
                api_key_id,
                auth.id
            )
            .execute(&*self.database)
            .await?;
        }

        Ok(())
    }

    /// Deletes an API key, revoking it immediately.
    ///
    /// # Permissions
    /// Your own keys always. Requires `ProjectPermissions::ADMIN_MANAGEMENT` to
    /// revoke someone else's key in a project you administrate; instance-wide
    /// keys can only be revoked by their owner or through the admin route.
    #[route("/{api_key_id}", method = DELETE)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found, api_key::not_found)]
    async fn delete_api_key(
        &self,
        #[special] auth: UserAuthentication,
        api_key_id: i32,
    ) -> Result<(), _> {
        let Some(key) = query!(
            r#"SELECT "user", project AS "project: ProjectId"
             FROM api_keys
             WHERE id = $1"#,
            api_key_id
        )
        .fetch_optional(&*self.database)
        .await?
        else {
            return Err(DeleteApiKeyError::ApiKeyNotFound);
        };

        if key.user != auth.id {
            let Some(project) = key.project else {
                return Err(DeleteApiKeyError::ApiKeyNotFound);
            };

            auth.require::<_, _, DeleteApiKeyError>(project, ProjectPermissions::ADMIN_MANAGEMENT)?;
        }

        query!("DELETE FROM api_keys WHERE id = $1", api_key_id)
            .execute(&*self.database)
            .await?;

        Ok(())
    }
}

fn ensure_scope_access<E: FromAuthPermissionDenied + FromProjectNotFound>(
    auth: &UserAuthentication,
    project: Option<ProjectId>,
) -> Result<(), E> {
    project.map_or_else(
        || auth.require::<_, _, E>((), ManagementPermissions::API_KEYS_MANAGE),
        |project| auth.require::<_, _, E>(project, ProjectPermissions::VIEW),
    )
}

pub(crate) fn grantable_permissions<E: FromApiKeyPermissionsExceeded>(
    access: &EffectivePermissions,
    project: Option<ProjectId>,
    permissions: i64,
) -> Result<i64, E> {
    let requested = with_dependencies(permissions) & key_scope(project.is_some());

    if requested & !grant_ceiling(access, project) == 0 {
        Ok(requested)
    } else {
        Err(<E as FromApiKeyPermissionsExceeded>::from())
    }
}

pub(crate) fn grant_ceiling(access: &EffectivePermissions, project: Option<ProjectId>) -> i64 {
    project.map_or_else(
        || access.permissions::<ManagementPermissions, _>(()).bits(),
        |project| access.permissions::<ProjectPermissions, _>(project).bits() & key_scope(true),
    )
}

const fn key_scope(scoped: bool) -> i64 {
    if scoped {
        ProjectPermissions::all().bits() | ServerPermissions::all().bits()
    } else {
        -1
    }
}

pub(crate) fn with_dependencies(permissions: i64) -> i64 {
    let project_scope = ProjectPermissions::all().bits() | ServerPermissions::all().bits();

    let scoped = ServerPermissions::from_bits_retain(permissions & project_scope)
        .with_dependencies()
        .bits();
    let scoped = ProjectPermissions::from_bits_retain(scoped)
        .with_dependencies()
        .bits();

    let management =
        ManagementPermissions::from_bits_retain(permissions & ManagementPermissions::all().bits())
            .with_dependencies()
            .bits();

    scoped | management
}
