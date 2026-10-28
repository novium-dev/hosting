use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use crate::auth::user::normalize_email;
use crate::db::project::ProjectId;
use crate::logo::{LOGO_MAX_BYTES, LogoFormat};
use crate::service::api_key::with_dependencies;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use crate::service::error_project_name_invalid::FromProjectNameInvalid;
use crate::service::error_project_not_found::FromProjectNotFound;
use crate::service::error_project_slug_invalid::FromProjectSlugInvalid;
use crate::service::project::project_service_error::{
    CreateProjectError, DeleteProjectError, DeleteProjectLogoError, GetProjectError,
    ListProjectUsersError, ListProjectsError, RemoveProjectUserError, SetProjectLogoError,
    SetProjectUserError, UpdateProjectError, UploadProjectLogoError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query, query_scalar};
use tokio::io::AsyncReadExt as _;
use tracing::{error, warn};
use url::Url;
use zelus::types::DataStream;
use zelus::{define_query_variable, service};

define_query_variable!(own "Only include projects owned by or shared with the current user");
define_query_variable!(slug "The project slug to check for availability");

const SLUG_MAX_LENGTH: usize = 64;
const NAME_MAX_LENGTH: usize = 64;
const LOGO_URL_MAX_LENGTH: usize = 1024;

const RESERVED_SLUGS: &[&str] = &[
    "accept-invitation",
    "admin",
    "api",
    "auth",
    "create",
    "error",
    "login",
    "logout",
    "novium",
    "onboarding",
    "profile",
    "settings",
    "signin",
    "signout",
    "signup",
    "static",
];

fn validate_slug<E: FromProjectSlugInvalid>(slug: &str) -> Result<(), E> {
    let valid = !slug.is_empty()
        && slug.len() <= SLUG_MAX_LENGTH
        && slug
            .chars()
            .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-')
        && !RESERVED_SLUGS.contains(&slug);

    if valid {
        Ok(())
    } else {
        Err(<E as FromProjectSlugInvalid>::from())
    }
}

fn validate_name<E: FromProjectNameInvalid>(name: &str) -> Result<(), E> {
    if name.trim().is_empty() || name.chars().count() > NAME_MAX_LENGTH {
        Err(<E as FromProjectNameInvalid>::from())
    } else {
        Ok(())
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectInfo {
    pub(crate) id: ProjectId,
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) logo_url: Option<String>,
    pub(crate) owner: i32,
    pub(crate) owner_username: String,
    pub(crate) server_count: i64,
    pub(crate) permissions: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectUserInfo {
    pub(crate) id: i32,
    pub(crate) username: String,
    pub(crate) email: String,
    pub(crate) avatar_url: String,
    pub(crate) permissions: i64,
    pub(crate) expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct SetProjectLogo {
    pub(crate) url: String,
}

#[service(path = "/project", tag = "project", no_sdk)]
pub(crate) impl ProjectService for Backend {
    /// Lists projects the current user can access.
    #[route("", method = GET, raw, query = [own])]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found)]
    async fn list_projects(
        &self,
        #[special] auth: Authentication,
        #[special] mut page: Option<PageSplit>,
        own: Option<bool>,
    ) -> Result<Paged<ProjectInfo>, _> {
        let own = own.unwrap_or_default();

        Ok(query!(
            r#"SELECT
                projects.id AS "id: ProjectId",
                projects.slug,
                projects.name,
                projects.logo_url,
                projects.owner,
                users.username AS owner_username,
                (SELECT COUNT(*) FROM servers WHERE servers.project = projects.id) AS "server_count!"
             FROM projects
             JOIN users ON users.id = projects.owner
             ORDER BY projects.slug"#
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .filter(|project| !own || auth.is_project_member(project.id))
        .filter(|project| {
            auth.require::<_, _, ListProjectsError>(project.id, ProjectPermissions::VIEW)
                .is_ok()
        })
        .map(|project| {
            let id = project.id;
            ProjectInfo {
                id,
                slug: project.slug,
                name: project.name,
                logo_url: project.logo_url,
                owner: project.owner,
                owner_username: project.owner_username,
                server_count: project.server_count,
                permissions: auth.permissions::<ProjectPermissions, _>(id).bits(),
            }
        })
        .apply_pagesplit(&mut page)
        .collect_paged(page))
    }

    /// Creates a new project owned by the current user, or, with
    /// [`ManagementPermissions::USER_MANAGE`], another user.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::USER_MANAGE`] if `owner` is set.
    /// Requires [`ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS`] if this
    /// instance does not let users create projects themselves.
    #[route("", method = PUT)]
    #[error(db::failure <- [sql:*], auth::{unreachable, permission_denied}, project::{slug_invalid, name_invalid}, user::not_found <- [sql:not_found])]
    async fn create_project(
        &self,
        #[special] auth: Authentication,
        slug: String,
        name: String,
        owner: Option<i32>,
    ) -> Result<String, _> {
        if !self.config.projects.self_creation {
            auth.require::<_, _, CreateProjectError>(
                (),
                ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS,
            )?;
        }

        validate_slug::<CreateProjectError>(&slug)?;
        validate_name::<CreateProjectError>(&name)?;

        let owner = if let Some(owner) = owner {
            auth.require::<_, _, CreateProjectError>((), ManagementPermissions::USER_MANAGE)?;

            query_scalar!("SELECT id FROM users WHERE id = $1", owner)
                .fetch_one(&*self.database)
                .await?
        } else {
            match auth {
                Authentication::User(user_auth) => user_auth.id,
                _ => {
                    return Err(CreateProjectError::UserNotFound);
                }
            }
        };

        let id = ProjectId::generate();

        query!(
            "INSERT INTO projects (id, slug, name, owner) VALUES ($1, $2, $3, $4)",
            &id,
            slug,
            name,
            owner
        )
        .execute(&*self.database)
        .await?;

        Ok(id.to_string())
    }

    /// Checks whether a project slug is already taken.
    #[route("/check-slug", method = GET, query = [slug])]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn check_project_slug(
        &self,
        #[special] _auth: Authentication,
        slug: String,
    ) -> Result<bool, _> {
        let taken = query_scalar!(
            r#"SELECT (COUNT(*) > 0) AS "taken!" FROM projects WHERE slug = $1"#,
            slug
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(taken)
    }

    /// Shows a project.
    #[route("/{project_id}", method = GET)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found <- [sql:not_found])]
    async fn get_project(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<ProjectInfo, _> {
        auth.require::<_, _, GetProjectError>(project_id, ProjectPermissions::VIEW)?;

        let project = query!(
            r#"SELECT
                projects.id AS "id: ProjectId",
                projects.slug,
                projects.name,
                projects.logo_url,
                projects.owner,
                users.username AS owner_username,
                (SELECT COUNT(*) FROM servers WHERE servers.project = projects.id) AS "server_count!"
             FROM projects
             JOIN users ON users.id = projects.owner
             WHERE projects.id = $1"#,
            &project_id
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(ProjectInfo {
            id: project.id,
            slug: project.slug,
            name: project.name,
            logo_url: project.logo_url,
            owner: project.owner,
            owner_username: project.owner_username,
            server_count: project.server_count,
            permissions: auth.permissions::<ProjectPermissions, _>(project_id).bits(),
        })
    }

    /// Updates project metadata.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`].
    /// Requires [`ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS`] to change the
    /// name or the slug if this instance does not let users rename their own projects.
    /// Only the current owner or a holder of [`ManagementPermissions::USER_MANAGE`]
    /// may transfer the ownership.
    #[route("/{project_id}", method = PATCH)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found <- [sql:not_found], slug_invalid, name_invalid}, user::not_found <- [sql:foreign_key])]
    async fn update_project(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        slug: Option<String>,
        name: Option<String>,
        owner: Option<i32>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateProjectError>(project_id, ProjectPermissions::ADMIN_MANAGEMENT)?;

        if !self.config.projects.self_update && (slug.is_some() || name.is_some()) {
            auth.require::<_, _, UpdateProjectError>(
                (),
                ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS,
            )?;
        }

        if let Some(slug) = slug.as_deref() {
            validate_slug::<UpdateProjectError>(slug)?;
        }

        if let Some(name) = name.as_deref() {
            validate_name::<UpdateProjectError>(name)?;
        }

        if owner.is_some()
            && !auth.has((), ManagementPermissions::USER_MANAGE)
            && auth.user_id() != Some(project_owner::<UpdateProjectError>(self, project_id).await?)
        {
            return Err(<UpdateProjectError as FromAuthPermissionDenied>::from());
        }

        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                if let Some(owner) = owner {
                    query!(
                        "UPDATE projects SET owner = $1 WHERE id = $2",
                        owner,
                        &project_id
                    )
                    .execute(&mut **tx)
                    .await?;
                }

                if let Some(slug) = slug {
                    query!(
                        "UPDATE projects SET slug = $1 WHERE id = $2",
                        slug,
                        &project_id
                    )
                    .execute(&mut **tx)
                    .await?;
                }

                if let Some(name) = name {
                    query!(
                        "UPDATE projects SET name = $1 WHERE id = $2",
                        name,
                        &project_id
                    )
                    .execute(&mut **tx)
                    .await?;
                }

                query!(
                    r#"SELECT id AS "id: ProjectId" FROM projects WHERE id = $1"#,
                    &project_id
                )
                .fetch_one(&mut **tx)
                .await?;

                Ok(())
            })
        })
        .await
    }

    /// Deletes an empty project.
    #[route("/{project_id}", method = DELETE)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found, not_empty <- [sql:foreign_key]})]
    async fn delete_project(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteProjectError>(project_id, ProjectPermissions::ADMIN_MANAGEMENT)?;

        let logo_url = query_scalar!(
            "DELETE FROM projects WHERE id = $1 RETURNING logo_url",
            &project_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(DeleteProjectError::ProjectNotFound)?;

        remove_stored_logo(self, project_id, logo_url).await;

        Ok(())
    }

    /// Sets the project logo to an image hosted under one of the instance's
    /// trusted logo URLs.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`].
    /// Requires [`ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS`] if this
    /// instance does not let users update their own projects.
    #[route("/{project_id}/logo", method = PUT)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found, logo_url_untrusted})]
    async fn set_project_logo(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        payload: SetProjectLogo,
    ) -> Result<(), _> {
        auth.require::<_, _, SetProjectLogoError>(
            project_id,
            ProjectPermissions::ADMIN_MANAGEMENT,
        )?;

        if !self.config.projects.self_update {
            auth.require::<_, _, SetProjectLogoError>(
                (),
                ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS,
            )?;
        }

        let trusted = payload.url.len() <= LOGO_URL_MAX_LENGTH
            && Url::parse(&payload.url).is_ok_and(|url| self.config.logos.is_trusted(&url));
        if !trusted {
            return Err(SetProjectLogoError::ProjectLogoUrlUntrusted);
        }

        replace_project_logo::<SetProjectLogoError>(self, project_id, Some(&payload.url)).await
    }

    /// Uploads an image as the project logo and returns its URL.
    ///
    /// The request body is the raw image: PNG, JPEG, GIF or WebP, at most 2 MiB.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`].
    /// Requires [`ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS`] if this
    /// instance does not let users update their own projects.
    #[route("/{project_id}/logo", method = POST)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found, logo_invalid, logo_upload_disabled, logo_storage_failure})]
    async fn upload_project_logo(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        data: DataStream,
    ) -> Result<String, _> {
        auth.require::<_, _, UploadProjectLogoError>(
            project_id,
            ProjectPermissions::ADMIN_MANAGEMENT,
        )?;

        if !self.config.projects.self_update {
            auth.require::<_, _, UploadProjectLogoError>(
                (),
                ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS,
            )?;
        }

        let upload = self
            .config
            .logos
            .upload
            .as_ref()
            .ok_or(UploadProjectLogoError::ProjectLogoUploadDisabled)?;
        ensure_project_exists::<UploadProjectLogoError>(self, project_id).await?;

        let limit = u64::try_from(LOGO_MAX_BYTES).unwrap_or(u64::MAX);
        let mut content = Vec::new();
        data.reader()
            .take(limit.saturating_add(1))
            .read_to_end(&mut content)
            .await
            .map_err(|_err| UploadProjectLogoError::ProjectLogoInvalid)?;
        if content.len() > LOGO_MAX_BYTES {
            return Err(UploadProjectLogoError::ProjectLogoInvalid);
        }
        let format =
            LogoFormat::detect(&content).ok_or(UploadProjectLogoError::ProjectLogoInvalid)?;

        let url = upload
            .store(&self.http_client, project_id, format, content)
            .await
            .map_err(|err| {
                error!("Failed to store the logo of project {project_id}: {err:?}");
                UploadProjectLogoError::ProjectLogoStorageFailure
            })?;

        replace_project_logo::<UploadProjectLogoError>(self, project_id, Some(&url)).await?;

        Ok(url)
    }

    /// Removes the project logo.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`].
    /// Requires [`ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS`] if this
    /// instance does not let users update their own projects.
    #[route("/{project_id}/logo", method = DELETE)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::not_found)]
    async fn delete_project_logo(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteProjectLogoError>(
            project_id,
            ProjectPermissions::ADMIN_MANAGEMENT,
        )?;

        if !self.config.projects.self_update {
            auth.require::<_, _, DeleteProjectLogoError>(
                (),
                ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS,
            )?;
        }

        replace_project_logo::<DeleteProjectLogoError>(self, project_id, None).await
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
        auth.require::<_, _, ListProjectUsersError>(project_id, ProjectPermissions::USER_VIEW)?;
        ensure_project_exists::<ListProjectUsersError>(self, project_id).await?;

        let owner = query!(
            "SELECT
                users.id,
                users.username,
                users.email,
                users.avatar_url
             FROM projects
             JOIN users ON users.id = projects.owner
             WHERE projects.id = $1",
            &project_id
        )
        .fetch_one(&*self.database)
        .await?;

        let project_users = query!(
            r#"SELECT
                users.id,
                users.username,
                users.email,
                users.avatar_url,
                project_users.permissions,
                project_users.expires_at
             FROM project_users
             JOIN users ON users.id = project_users."user"
             JOIN projects ON projects.id = project_users.project
            WHERE project_users.project = $1
              AND project_users."user" != projects.owner
              AND (project_users.expires_at IS NULL OR project_users.expires_at > now())"#,
            &project_id,
        )
        .fetch_all(&*self.database)
        .await?;

        Ok(core::iter::once(ProjectUserInfo {
            id: owner.id,
            username: owner.username,
            email: owner.email,
            avatar_url: owner.avatar_url.unwrap_or_default(),
            permissions: ProjectPermissions::all().bits() | ServerPermissions::all().bits(),
            expires_at: None,
        })
        .chain(project_users.into_iter().map(|user| ProjectUserInfo {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url.unwrap_or_default(),
            permissions: user.permissions,
            expires_at: user.expires_at,
        }))
        .apply_pagesplit(&mut page)
        .collect_paged(page))
    }

    /// Sets project permissions for a user, identified by email.
    ///
    /// An `expires_at` timestamp limits the membership to that point in time;
    /// omitting it grants access until the member is removed. The project owner
    /// always holds every permission and cannot be changed.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::USER_EDIT`]. Both the granted permissions
    /// and the member's current ones may never exceed your own.
    #[route("/{project_id}/users", method = PUT)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found, expiry_invalid, owner_immutable}, user::not_found <- [sql:not_found])]
    async fn set_project_user(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        email: String,
        permissions: i64,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<(), _> {
        auth.require::<_, _, SetProjectUserError>(project_id, ProjectPermissions::USER_EDIT)?;
        let owner = project_owner::<SetProjectUserError>(self, project_id).await?;

        if expires_at.is_some_and(|expires_at| expires_at <= Utc::now()) {
            return Err(SetProjectUserError::ProjectExpiryInvalid);
        }

        let user_id = query_scalar!(
            "SELECT id FROM users WHERE email = $1",
            normalize_email(&email)
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(SetProjectUserError::UserNotFound)?;

        if user_id == owner {
            return Err(SetProjectUserError::ProjectOwnerImmutable);
        }

        let permissions = with_dependencies(permissions) & MEMBER_SCOPE;
        ensure_grantable::<SetProjectUserError>(&auth, project_id, permissions)?;
        ensure_member_grantable::<SetProjectUserError>(self, &auth, project_id, user_id).await?;

        query!(
            r#"INSERT INTO project_users ("user", project, permissions, expires_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("user", project) DO UPDATE SET
                permissions = EXCLUDED.permissions,
                expires_at = EXCLUDED.expires_at"#,
            user_id,
            &project_id,
            permissions,
            expires_at
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }

    /// Removes a project member.
    ///
    /// The project owner cannot be removed.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::USER_EDIT`]. The member's permissions may
    /// never exceed your own.
    #[route("/{project_id}/users/{user_id}", method = DELETE)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found, owner_immutable})]
    async fn remove_project_user(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        user_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, RemoveProjectUserError>(project_id, ProjectPermissions::USER_EDIT)?;

        if project_owner::<RemoveProjectUserError>(self, project_id).await? == user_id {
            return Err(RemoveProjectUserError::ProjectOwnerImmutable);
        }

        ensure_member_grantable::<RemoveProjectUserError>(self, &auth, project_id, user_id).await?;

        query!(
            r#"DELETE FROM project_users WHERE project = $1 AND "user" = $2"#,
            &project_id,
            user_id
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }
}

const MEMBER_SCOPE: i64 = ProjectPermissions::all().bits() | ServerPermissions::all().bits();

fn ensure_grantable<E: FromAuthPermissionDenied>(
    auth: &Authentication,
    project_id: ProjectId,
    permissions: i64,
) -> Result<(), E> {
    let allowed = auth.permissions::<ProjectPermissions, _>(project_id).bits() & MEMBER_SCOPE;

    if permissions & MEMBER_SCOPE & !allowed == 0 {
        Ok(())
    } else {
        Err(<E as FromAuthPermissionDenied>::from())
    }
}

async fn ensure_member_grantable<E: From<sqlx::Error> + FromAuthPermissionDenied>(
    backend: &Backend,
    auth: &Authentication,
    project_id: ProjectId,
    user_id: i32,
) -> Result<(), E> {
    let current = query_scalar!(
        r#"SELECT permissions FROM project_users WHERE project = $1 AND "user" = $2"#,
        &project_id,
        user_id
    )
    .fetch_optional(&*backend.database)
    .await?
    .unwrap_or_default();

    ensure_grantable::<E>(auth, project_id, current)
}

async fn project_owner<E: From<sqlx::Error> + FromProjectNotFound>(
    backend: &Backend,
    project_id: ProjectId,
) -> Result<i32, E> {
    query_scalar!("SELECT owner FROM projects WHERE id = $1", &project_id)
        .fetch_optional(&*backend.database)
        .await?
        .ok_or_else(<E as FromProjectNotFound>::from)
}

async fn ensure_project_exists<E: From<sqlx::Error> + FromProjectNotFound>(
    backend: &Backend,
    project_id: ProjectId,
) -> Result<(), E> {
    let exists = query_scalar!(
        r#"SELECT (COUNT(*) > 0) AS "exists!" FROM projects WHERE id = $1"#,
        &project_id
    )
    .fetch_one(&*backend.database)
    .await?;

    if exists {
        Ok(())
    } else {
        Err(<E as FromProjectNotFound>::from())
    }
}

async fn replace_project_logo<E: From<sqlx::Error> + FromProjectNotFound>(
    backend: &Backend,
    project_id: ProjectId,
    logo_url: Option<&str>,
) -> Result<(), E> {
    let previous = query_scalar!(
        r#"UPDATE projects SET logo_url = $1 WHERE id = $2
         RETURNING (SELECT logo_url FROM projects WHERE id = $2) AS "previous""#,
        logo_url,
        &project_id
    )
    .fetch_optional(&*backend.database)
    .await?
    .ok_or_else(<E as FromProjectNotFound>::from)?;

    if previous.as_deref() != logo_url {
        remove_stored_logo(backend, project_id, previous).await;
    }

    Ok(())
}

async fn remove_stored_logo(backend: &Backend, project_id: ProjectId, logo_url: Option<String>) {
    let (Some(upload), Some(logo_url)) = (backend.config.logos.upload.as_ref(), logo_url) else {
        return;
    };

    if let Err(err) = upload
        .remove(&backend.http_client, project_id, &logo_url)
        .await
    {
        warn!("Failed to remove the stored logo of project {project_id}: {err:?}");
    }
}
