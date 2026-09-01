use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use crate::auth::user::avatar_url;
use crate::db::feature::ProjectFeature;
use crate::db::project::ProjectId;
use crate::service::error_project_not_found::FromProjectNotFound;
use crate::service::error_project_slug_invalid::FromProjectSlugInvalid;
use crate::service::project::project_service_error::{
    CreateProjectError, DeleteProjectError, GetProjectError, ListProjectUsersError,
    ListProjectsError, RemoveProjectUserError, SetProjectUserError, UpdateProjectError,
};
use crate::utils::{PageSplit, PageSplitExtension as _, Paged};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{query, query_scalar};
use zelus::{define_query_variable, service};

define_query_variable!(own "Only include projects owned by or shared with the current user");
define_query_variable!(slug "The project slug to check for availability");

const SLUG_MAX_LENGTH: usize = 64;

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

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectInfo {
    pub(crate) id: ProjectId,
    pub(crate) slug: String,
    pub(crate) name: String,
    pub(crate) owner: i32,
    pub(crate) owner_username: String,
    pub(crate) server_count: i64,
    pub(crate) permissions: i64,
    pub(crate) features: Vec<ProjectFeature>,
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

        let mut features = self.all_project_features().await?;

        Ok(query!(
            r#"SELECT
                projects.id AS "id: ProjectId",
                projects.slug,
                projects.name,
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
                owner: project.owner,
                owner_username: project.owner_username,
                server_count: project.server_count,
                permissions: auth.permissions::<ProjectPermissions, _>(id).bits(),
                features: features.remove(&id).unwrap_or_default(),
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
    /// Requires [`ManagementPermissions::LIMITS_BYPASS`] if this instance does
    /// not let users create projects themselves.
    #[route("", method = PUT)]
    #[error(db::failure <- [sql:*], auth::{unreachable, permission_denied}, project::slug_invalid, user::not_found <- [sql:not_found])]
    async fn create_project(
        &self,
        #[special] auth: Authentication,
        slug: String,
        name: String,
        owner: Option<i32>,
    ) -> Result<String, _> {
        if !self.config.projects.self_creation {
            auth.require::<_, _, CreateProjectError>((), ManagementPermissions::LIMITS_BYPASS)?;
        }

        validate_slug::<CreateProjectError>(&slug)?;

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
            owner: project.owner,
            owner_username: project.owner_username,
            server_count: project.server_count,
            permissions: auth.permissions::<ProjectPermissions, _>(project_id).bits(),
            features: self.project_features(project_id).await?,
        })
    }

    /// Updates project metadata.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::ADMIN_MANAGEMENT`].
    /// Requires [`ManagementPermissions::LIMITS_BYPASS`] to change the name or
    /// the slug if this instance does not let users rename their own projects.
    #[route("/{project_id}", method = PATCH)]
    #[error(db::failure <- [sql:*], auth::{permission_denied, unreachable}, project::{not_found <- [sql:not_found], slug_invalid}, user::not_found <- [sql:foreign_key])]
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
            auth.require::<_, _, UpdateProjectError>((), ManagementPermissions::LIMITS_BYPASS)?;
        }

        if let Some(slug) = slug.as_deref() {
            validate_slug::<UpdateProjectError>(slug)?;
        }

        let mut tx = self.database.begin().await?;

        if let Some(owner) = owner {
            query!(
                "UPDATE projects SET owner = $1 WHERE id = $2",
                owner,
                &project_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(slug) = slug {
            query!(
                "UPDATE projects SET slug = $1 WHERE id = $2",
                slug,
                &project_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(name) = name {
            query!(
                "UPDATE projects SET name = $1 WHERE id = $2",
                name,
                &project_id
            )
            .execute(&mut *tx)
            .await?;
        }

        query!(
            r#"SELECT id AS "id: ProjectId" FROM projects WHERE id = $1"#,
            &project_id
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
        auth.require::<_, _, DeleteProjectError>(project_id, ProjectPermissions::ADMIN_MANAGEMENT)?;

        let result = query!("DELETE FROM projects WHERE id = $1", &project_id)
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
        auth.require::<_, _, ListProjectUsersError>(project_id, ProjectPermissions::USER_VIEW)?;
        ensure_project_exists::<ListProjectUsersError>(self, project_id).await?;

        let owner = query!(
            "SELECT
                users.id,
                users.username,
                users.email,
                users.auth_id
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
                users.auth_id,
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
            avatar_url: avatar_url(&owner.auth_id),
            permissions: ProjectPermissions::all().bits() | ServerPermissions::all().bits(),
            expires_at: None,
        })
        .chain(project_users.into_iter().map(|user| ProjectUserInfo {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: avatar_url(&user.auth_id),
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

        let user_id = query_scalar!("SELECT id FROM users WHERE email = $1", email)
            .fetch_one(&*self.database)
            .await?;

        if user_id == owner {
            return Err(SetProjectUserError::ProjectOwnerImmutable);
        }

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
