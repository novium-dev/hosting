use crate::Backend;
use crate::auth::oauth::AuthUser;
use crate::auth::permissions::{
    HasPermission, Permission, ProjectPermissions, Role, ServerPermissions,
};
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use axum::Extension;
use axum::extract::FromRequestParts as _;
use axum_extra::TypedHeader;
use axum_extra::headers::Authorization;
use axum_extra::headers::authorization::Credentials;
use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use core::fmt::Debug;
use core::fmt::{Display, Formatter};
use core::str::FromStr;
use http::HeaderValue;
use http::request::Parts;
use lazy_regex::lazy_regex;
use rand::TryRng as _;
use redis::{AsyncCommands as _, RedisError};
use regex::Regex;
use serde::{Deserialize, Serialize, Serializer as _};
use sqlx::{query, query_scalar};
use std::collections::HashMap;
use tracing::error;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

#[derive(Debug)]
pub struct UserAuthentication {
    pub id: u32,
    pub session: Session,
    username: String,
    permissions: i64,
    role: Role,
    email: String,
    projects: HashMap<ProjectId, i64>,
    servers: HashMap<ServerId, i64>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SerializedUser {
    pub id: u32,
    pub username: String,
    pub permissions: i64,
    pub role: Role,
    pub email: String,
}

impl UserAuthentication {
    pub fn has<P: HasPermission<Extra>, Extra>(&self, extra: Extra, permission: P) -> bool {
        permission.has(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn require<P: Permission<Extra, E>, Extra, E>(
        &self,
        extra: Extra,
        permission: P,
    ) -> Result<(), E> {
        permission.require(extra, self.permissions, &self.projects, &self.servers)
    }

    pub fn project_permissions(&self, project: ProjectId) -> ProjectPermissions {
        ProjectPermissions::from_bits_retain(
            self.projects.get(&project).copied().unwrap_or_default(),
        ) | ProjectPermissions::from_bits_retain(self.permissions)
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

        let Some(TypedHeader(Authorization(session))) =
            <Option<TypedHeader<Authorization<Session>>>>::from_request_parts(parts, &())
                .await
                .map_err(|_err| <E as FromAuthInvalid>::from())?
        else {
            return Ok(None);
        };

        let Some(id) = session.authenticate::<E>(&backend).await? else {
            return Ok(None);
        };

        let mut conn = backend
            .database
            .acquire()
            .await
            .inspect_err(|err| error!("Unable to acquire database connection: {err:?}"))?;

        let Some(user) = query!(
            "SELECT `username`, `role` AS `role: u8`, `email` FROM `users` WHERE `id` = ?",
            &id
        )
        .fetch_optional(&mut *conn)
        .await
        .inspect_err(|err| {
            error!("Unable to fetch permissions for user {id}: {err:?}");
        })?
        else {
            session.invalidate(&backend).await.map_err(|err| {
                error!("Unable to invalidate missing user session: {err:?}");
                <E as FromAuthUnreachable>::from()
            })?;
            return Ok(None);
        };

        let owned_projects: HashMap<_, _> = query_scalar!(
            "SELECT `id` AS `id: ProjectId` FROM `projects` WHERE `owner` = ?",
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| {
            error!("Unable to fetch owned servers for user {id}: {err:?}");
        })?
        .into_iter()
        .map(|id| {
            (
                id,
                ProjectPermissions::all().bits() | ServerPermissions::all().bits(),
            )
        })
        .collect();

        let mut projects: HashMap<ProjectId, i64> = query!(
            "SELECT `project` AS `project: ProjectId`, `permissions`
             FROM `project_users`
             WHERE `user` = ?",
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch project permissions for user {id}: {err:?}"))?
        .into_iter()
        .map(|record| (record.project, record.permissions))
        .collect();
        projects.extend(owned_projects);

        let servers: HashMap<ServerId, i64> = query!(
            "SELECT
                `servers`.`id` AS `server: ServerId`,
                `servers`.`project` AS `project: ProjectId`
             FROM `servers`
             JOIN `projects` ON `projects`.`id` = `servers`.`project`
             LEFT JOIN `project_users`
                ON `project_users`.`project` = `servers`.`project`
                AND `project_users`.`user` = ?
             WHERE `projects`.`owner` = ? OR `project_users`.`user` IS NOT NULL",
            &id,
            &id
        )
        .fetch_all(&mut *conn)
        .await
        .inspect_err(|err| error!("Unable to fetch server permissions for user {id}: {err:?}"))?
        .into_iter()
        .filter_map(|record| {
            projects
                .get(&record.project)
                .copied()
                .map(|permissions| (record.server, permissions))
        })
        .collect();

        let role = Role::try_from(user.role).ok();

        Ok(Some(Self {
            id,
            session,
            username: user.username,
            permissions: role
                .map(|role| {
                    role.management_permissions().bits()
                        | role.project_permissions().bits()
                        | role.server_permissions().bits()
                })
                .unwrap_or_default(),
            role: role.unwrap_or(Role::User),
            email: user.email,
            projects,
            servers,
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

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static SESSION_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!("Session\\s{1,}(?:[A-Za-z0-9+\\/]{171})=");
const SESSION_SIZE: usize = 128;

#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct Session([u8; SESSION_SIZE]);

impl Session {
    pub fn generate() -> Result<Self, core::convert::Infallible> {
        let mut slice = [0; SESSION_SIZE];
        rand::rng().try_fill_bytes(&mut slice)?;
        Ok(Self(slice))
    }

    fn key(&self) -> String {
        format!("{}session:{self}", crate::CACHE_PREFIX)
    }

    pub async fn invalidate(&self, backend: &Backend) -> Result<(), RedisError> {
        let _: () = backend
            .cache
            .clone()
            .del(self.key())
            .await
            .inspect_err(|err| error!("Unable to invalidate session: {err:?}"))?;
        Ok(())
    }

    pub async fn apply(&self, backend: &Backend, user: u32) -> Result<(), RedisError> {
        let _: () = backend
            .cache
            .clone()
            .set_ex(self.key(), user, backend.config.session_lifetime)
            .await
            .inspect_err(|err| error!("Unable to apply session: {err:?}"))?;
        Ok(())
    }

    pub async fn authenticate<E: FromAuthUnreachable>(
        &self,
        backend: &Backend,
    ) -> Result<Option<u32>, E> {
        let Some(user) = backend
            .cache
            .clone()
            .get::<_, Option<u32>>(self.key())
            .await
            .inspect_err(|err| error!("Unable to retrieve session: {err:?}"))
            .map_err(|_err| <E as FromAuthUnreachable>::from())?
        else {
            return Ok(None);
        };

        self.apply(backend, user).await.map_err(|err| {
            error!("Unable to refresh session: {err:?}");
            <E as FromAuthUnreachable>::from()
        })?;
        Ok(Some(user))
    }
}

impl Credentials for Session {
    const SCHEME: &'static str = "Session";

    #[expect(
        clippy::indexing_slicing,
        reason = "validated before by `Authorization`"
    )]
    fn decode(value: &HeaderValue) -> Option<Self> {
        let bytes = &value.as_bytes()["Session ".len()..];
        let non_space_pos = bytes.iter().position(|byte| *byte != b' ')?;
        let bytes = &bytes[non_space_pos..];
        Self::try_from(bytes).ok()
    }

    fn encode(&self) -> HeaderValue {
        HeaderValue::try_from(self.to_string()).expect("Unable to encode session")
    }
}

impl Display for Session {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.serialize_str(&BASE64_STANDARD.encode(self.0))
    }
}

impl Debug for Session {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_tuple("Session")
            .field(&BASE64_STANDARD.encode(self.0))
            .finish()
    }
}

impl FromStr for Session {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::try_from(value.as_bytes())
    }
}

impl<'a> TryFrom<&'a [u8]> for Session {
    type Error = ();

    fn try_from(value: &'a [u8]) -> Result<Self, Self::Error> {
        let slice = BASE64_STANDARD.decode(value).map_err(|_err| ())?;
        let mut session = [0u8; SESSION_SIZE];
        if slice.len() != SESSION_SIZE {
            return Err(());
        }
        session.copy_from_slice(&slice);
        Ok(Self(session))
    }
}

impl DocumentedType for UserAuthentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(
            ParameterBuilder::new()
                .name("Authorization")
                .parameter_in(ParameterIn::Header)
                .description(Some("The session token"))
                .schema(Some(RefOr::T(Schema::Object(
                    Object::builder()
                        .schema_type(SchemaType::Type(Type::String))
                        .min_length(Some(180))
                        .pattern(Some(SESSION_REGEX.as_str()))
                        .build(),
                ))))
                .required(Required::False),
        )
    }
}

impl Backend {
    pub async fn get_or_create_user(&self, auth_user: AuthUser) -> Result<u32, sqlx::Error> {
        let result = query!(
            r#"
    INSERT INTO `users`
        (`username`, `auth_id`, `role`, `email`)
    VALUES
        (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        `username` = VALUES(`username`),
        `email` = VALUES(`email`),
        `id` = LAST_INSERT_ID(`id`)
    "#,
            auth_user.preferred_username,
            auth_user.sub,
            Role::User as u8,
            auth_user.email
        )
        .execute(&*self.database)
        .await?;

        Ok(result.last_insert_id() as u32)
    }
}
