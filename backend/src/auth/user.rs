use crate::Backend;
use crate::auth::api_key::is_api_key_request;
use crate::auth::effective::EffectivePermissions;
use crate::auth::oauth::AuthUser;
use crate::auth::permissions::{HasPermission, Permission, Role};
use crate::auth::session::{SESSION_COOKIE_NAME, Session, SessionToken, session_cookie_parameter};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use axum::Extension;
use axum::response::{IntoResponse, Response};
use axum_extra::extract::cookie::CookieJar;
use core::fmt::Debug;
use core::str::FromStr as _;
use http::HeaderValue;
use http::header::SET_COOKIE;
use http::request::Parts;
use serde::{Deserialize, Serialize};
use sqlx::query;
use std::collections::HashMap;
use tracing::error;
use url::Url;
use utoipa::openapi::path::OperationBuilder;
use utoipa::openapi::{RefOr, ResponsesBuilder, Schema};
use zelus::responses::DocumentedResultResponse;
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

const DAEMON_PASSWORD_LENGTH: usize = 32;

#[derive(Debug)]
pub struct UserAuthentication {
    pub id: i32,
    pub session: Session,
    username: String,
    permissions: i64,
    role: Role,
    email: String,
    avatar_url: String,
    first_name: Option<String>,
    last_name: Option<String>,
    projects: HashMap<ProjectId, i64>,
    servers: HashMap<ServerId, i64>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SerializedUser {
    pub id: i32,
    pub username: String,
    pub permissions: i64,
    pub role: Role,
    pub email: String,
    pub avatar_url: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

impl UserAuthentication {
    pub fn has<P: HasPermission<Extra>, Extra>(&self, extra: Extra, permission: P) -> bool {
        permission.has(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn permissions<P: HasPermission<Extra>, Extra>(&self, extra: Extra) -> P {
        P::permissions(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn require<P: Permission<Extra, E>, Extra, E>(
        &self,
        extra: Extra,
        permission: P,
    ) -> Result<(), E> {
        permission.require(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn is_project_member(&self, project: ProjectId) -> bool {
        self.projects.contains_key(&project)
    }

    pub fn serialized(&self) -> SerializedUser {
        SerializedUser {
            id: self.id,
            username: self.username.clone(),
            permissions: self.permissions,
            role: self.role,
            email: self.email.clone(),
            avatar_url: self.avatar_url.clone(),
            first_name: self.first_name.clone(),
            last_name: self.last_name.clone(),
        }
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync>
    OptionalFromRequestParts<E> for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Option<Self>, E> {
        let Extension(backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        if is_api_key_request(&parts.headers) {
            return Ok(None);
        }

        let Some(token) = CookieJar::from_headers(&parts.headers)
            .get(SESSION_COOKIE_NAME)
            .and_then(|cookie| SessionToken::from_str(cookie.value()).ok())
        else {
            return Ok(None);
        };

        let Some(session) = Session::authenticate::<E>(&token, &backend).await? else {
            return Ok(None);
        };

        let id = session.user;

        let mut conn = backend
            .database
            .acquire()
            .await
            .inspect_err(|err| error!("Unable to acquire database connection: {err:?}"))?;

        let Some(user) = query!(
            r#"SELECT username, role AS "role: i32", email, first_name, last_name
             FROM users
             WHERE id = $1"#,
            &id
        )
        .fetch_optional(&mut *conn)
        .await
        .inspect_err(|err| {
            error!("Unable to fetch permissions for user {id}: {err:?}");
        })?
        else {
            session.revoke::<E>(&backend).await?;
            return Ok(None);
        };

        let role = u8::try_from(user.role)
            .ok()
            .and_then(|role| Role::try_from(role).ok());

        let effective = EffectivePermissions::load(&mut conn, id, role).await?;

        Ok(Some(Self {
            id,
            session,
            username: user.username,
            permissions: effective.permissions,
            role: role.unwrap_or(Role::User),
            email: user.email,
            avatar_url: backend.avatar_url(),
            first_name: user.first_name,
            last_name: user.last_name,
            projects: effective.projects,
            servers: effective.servers,
        }))
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + FromAuthUnreachable + Send + Sync> FromRequestParts<E>
    for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        <Self as OptionalFromRequestParts<E>>::from_request_parts(parts)
            .await?
            .ok_or_else(<E as FromAuthInvalid>::from)
    }
}

pub struct WithCookies<T> {
    inner: T,
    cookies: Vec<HeaderValue>,
}

impl<T> WithCookies<T> {
    pub const fn new(inner: T, cookies: Vec<HeaderValue>) -> Self {
        Self { inner, cookies }
    }
}

impl<T: IntoResponse> IntoResponse for WithCookies<T> {
    fn into_response(self) -> Response {
        let mut response = self.inner.into_response();
        let headers = response.headers_mut();
        for cookie in self.cookies {
            headers.append(SET_COOKIE, cookie);
        }
        response
    }
}

impl<T: DocumentedResultResponse> DocumentedResultResponse for WithCookies<T> {
    fn openapi(
        responses: ResponsesBuilder,
        schemas: &mut HashMap<String, RefOr<Schema>>,
    ) -> ResponsesBuilder {
        T::openapi(responses, schemas)
    }
}

impl DocumentedType for UserAuthentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(session_cookie_parameter())
    }
}

impl Backend {
    pub fn avatar_url(&self) -> String {
        self.config
            .logo_url
            .as_ref()
            .map(Url::to_string)
            .unwrap_or_default()
    }

    pub async fn get_or_create_user(
        &self,
        auth_user: AuthUser,
        role: Option<Role>,
    ) -> Result<i32, sqlx::Error> {
        let daemon_password = generate_daemon_password();
        let mapped_role = role.map(|role| role as i32);
        let record = query!(
            r#"
    INSERT INTO users
        (username, auth_id, role, email, first_name, last_name, daemon_password)
    VALUES
        ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (auth_id) DO UPDATE SET
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role = COALESCE($8, users.role)
    RETURNING id
    "#,
            auth_user
                .username
                .or(auth_user.preferred_username)
                .unwrap_or_else(|| auth_user.email.clone()),
            auth_user.sub,
            mapped_role.unwrap_or(Role::User as i32),
            auth_user.email,
            auth_user.given_name,
            auth_user.family_name,
            daemon_password,
            mapped_role
        )
        .fetch_one(&*self.database)
        .await?;

        Ok(record.id)
    }
}

pub(crate) fn generate_daemon_password() -> String {
    nanoid::format(
        nanoid::rngs::default,
        &nanoid::alphabet::SAFE,
        DAEMON_PASSWORD_LENGTH,
    )
}
