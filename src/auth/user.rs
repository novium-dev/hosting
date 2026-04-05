use crate::Backend;
use crate::auth::permissions::{
    HasPermission, ManagementPermissions, Permission, ProjectRole, Role, ServerPermissions,
};
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
use axum::Extension;
use axum::extract::FromRequestParts as _;
use axum_extra::TypedHeader;
use axum_extra::headers::Authorization;
use axum_extra::headers::authorization::Bearer;
use core::str::FromStr;
use http::request::Parts;
use jsonwebtoken::{Algorithm, TokenData, Validation, decode, decode_header};
use lazy_regex::lazy_regex;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::query;
use std::collections::HashMap;
use tracing::error;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

#[derive(Debug)]
pub struct UserAuthentication {
    pub id: String,
    name: Option<String>,
    role: Option<String>,
    email: Option<String>,
    permissions: i64,
    servers: HashMap<ServerId, ServerPermissions>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    iss: String,
    exp: usize,
    #[serde(default)]
    iat: Option<usize>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default, rename = "emailVerified")]
    email_verified: Option<bool>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    orgs: Vec<OrgClaim>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PermissionClaim {
    resource: String,
    action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OrgClaim {
    id: String,
    role: ProjectRole,
    #[serde(default)]
    permissions: Vec<PermissionClaim>,
}

#[derive(Default)]
struct ResolvedPermissions {
    project_permissions: HashMap<String, ServerPermissions>,
    server_permissions: HashMap<ServerId, ServerPermissions>,
}

#[derive(Clone)]
enum PermissionScope {
    Project(String),
    Server(ServerId),
}

impl UserAuthentication {
    pub fn has<P: HasPermission>(&self, extra: P::Extra, permission: P) -> bool {
        permission.has(extra, self.permissions, &self.servers)
    }

    pub fn require<P: Permission<E>, E>(&self, extra: P::Extra, permission: P) -> Result<(), E> {
        permission.require(extra, self.permissions, &self.servers)
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + Send + Sync> OptionalFromRequestParts<E>
    for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Option<Self>, E> {
        let Extension(backend) =
            <Extension<Backend> as axum::extract::FromRequestParts<()>>::from_request_parts(
                parts,
                &(),
            )
            .await
            .expect("Extension not registered");

        let Some(TypedHeader(Authorization(bearer))) =
            <Option<TypedHeader<Authorization<Bearer>>>>::from_request_parts(parts, &())
                .await
                .map_err(|_err| <E as FromAuthInvalid>::from())?
        else {
            return Ok(None);
        };

        let claims = decode_claims::<E>(bearer.token(), &backend).await?;
        let mut resolved = resolve_permissions(&claims);
        apply_project_permissions::<E>(&backend, &mut resolved).await?;
        let role = claims.role;
        let global_management_permissions = role
            .as_deref()
            .and_then(|value| Role::from_str(value).ok())
            .map(Role::management_permissions)
            .unwrap_or_else(ManagementPermissions::empty)
            .bits();

        Ok(Some(Self {
            id: claims.id.unwrap_or(claims.sub),
            name: claims.name,
            role,
            email: claims.email,
            permissions: global_management_permissions,
            servers: resolved.server_permissions,
        }))
    }
}

impl<E: From<sqlx::Error> + FromAuthInvalid + Send + Sync> FromRequestParts<E>
    for UserAuthentication
{
    async fn from_request_parts(parts: &mut Parts) -> Result<Self, E> {
        <Self as OptionalFromRequestParts<E>>::from_request_parts(parts)
            .await?
            .ok_or_else(<E as FromAuthInvalid>::from)
    }
}

async fn decode_claims<E: FromAuthInvalid>(token: &str, backend: &Backend) -> Result<Claims, E> {
    let header = decode_header(token).map_err(|err| {
        error!("Unable to decode JWT header: {err}");
        <E as FromAuthInvalid>::from()
    })?;
    let Some(kid) = header.kid.as_deref() else {
        error!("Missing kid in JWT header");
        return Err(<E as FromAuthInvalid>::from());
    };

    let keyset = backend.jwks_storage.fetch().await.map_err(|err| {
        error!("Unable to fetch JWKS: {err}");
        <E as FromAuthInvalid>::from()
    })?;

    let decoding_key = if let Some(jwk) = keyset.keys.get(kid) {
        jwk.decoding_key.clone()
    } else {
        let refreshed = backend.jwks_storage.refresh().await.map_err(|err| {
            error!("Unable to refresh JWKS: {err}");
            <E as FromAuthInvalid>::from()
        })?;
        let Some(jwk) = refreshed.keys.get(kid) else {
            error!("JWT kid not present in JWKS: {kid}");
            return Err(<E as FromAuthInvalid>::from());
        };
        jwk.decoding_key.clone()
    };

    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.validate_exp = true;
    validation.validate_nbf = false;
    validation.set_issuer(&[backend.config.auth.issuer.as_str()]);
    if !backend.config.auth.audiences.is_empty() {
        validation.set_audience(&backend.config.auth.audiences);
    }

    let decoded_token: TokenData<Claims> = decode::<Claims>(token, &decoding_key, &validation)
        .map_err(|err| {
            error!("Unable to decode JWT: {err}");
            <E as FromAuthInvalid>::from()
        })?;

    Ok(decoded_token.claims)
}

fn resolve_permissions(claims: &Claims) -> ResolvedPermissions {
    let mut resolved = ResolvedPermissions::default();

    for org in &claims.orgs {
        apply_org_claim(org, &mut resolved);
    }

    resolved
}

async fn apply_project_permissions<E: From<sqlx::Error> + FromAuthInvalid>(
    backend: &Backend,
    resolved: &mut ResolvedPermissions,
) -> Result<(), E> {
    if resolved.project_permissions.is_empty() {
        return Ok(());
    }

    let records = query!("SELECT `id` AS `id: ServerId`, `owner` FROM `servers`")
        .fetch_all(&*backend.database)
        .await
        .map_err(|err| {
            error!("Unable to expand project permissions: {err:?}");
            <E as From<sqlx::Error>>::from(err)
        })?;

    for record in records {
        let Some(project_permissions) = resolved.project_permissions.get(&record.owner).copied()
        else {
            continue;
        };

        resolved
            .server_permissions
            .entry(record.id)
            .and_modify(|permissions| *permissions |= project_permissions)
            .or_insert(project_permissions);
    }

    Ok(())
}

fn apply_org_claim(org: &OrgClaim, resolved: &mut ResolvedPermissions) {
    let project_id = org.id.trim();
    if project_id.is_empty() {
        return;
    }

    let project_id_owned = project_id.to_owned();
    grant_project_permissions(
        resolved,
        project_id_owned.clone(),
        org.role.server_permissions(),
    );

    apply_permissions(
        &org.permissions,
        PermissionScope::Project(project_id_owned),
        resolved,
    );
}

fn apply_permissions(
    permissions: &[PermissionClaim],
    default_scope: PermissionScope,
    resolved: &mut ResolvedPermissions,
) {
    for permission in permissions {
        apply_permission(permission, default_scope.clone(), resolved);
    }
}

fn apply_permission(
    permission: &PermissionClaim,
    default_scope: PermissionScope,
    resolved: &mut ResolvedPermissions,
) {
    let (scope, action) = permission_scope_and_action(permission, default_scope);

    match scope {
        PermissionScope::Project(project_id) => {
            grant_project_permissions(
                resolved,
                project_id,
                server_permissions_from_action(&action),
            );
        }
        PermissionScope::Server(server_id) => {
            grant_server_permissions(resolved, server_id, server_permissions_from_action(&action));
        }
    }
}

fn permission_scope_and_action(
    permission: &PermissionClaim,
    default_scope: PermissionScope,
) -> (PermissionScope, String) {
    let action = permission.action.trim().to_ascii_lowercase();
    if let Some(scope) = scope_from_resource(&permission.resource) {
        return (scope, action);
    }
    (default_scope, action)
}

fn scope_from_resource(resource: &str) -> Option<PermissionScope> {
    let resource = resource.trim();
    if resource == "*" {
        return None;
    }

    if let Some(server) =
        strip_prefix_case_insensitive(resource, &["server:", "server/", "server_"])
    {
        return ServerId::from_str(server).ok().map(PermissionScope::Server);
    }

    ServerId::from_str(resource)
        .ok()
        .map(PermissionScope::Server)
}

fn server_permissions_from_action(action: &str) -> ServerPermissions {
    ServerPermissions::from_claim_action(action).unwrap_or_default()
}

fn grant_project_permissions(
    resolved: &mut ResolvedPermissions,
    project_id: String,
    permissions: ServerPermissions,
) {
    if permissions.is_empty() {
        return;
    }

    resolved
        .project_permissions
        .entry(project_id)
        .and_modify(|existing_permissions| *existing_permissions |= permissions)
        .or_insert(permissions);
}

fn grant_server_permissions(
    resolved: &mut ResolvedPermissions,
    server_id: ServerId,
    permissions: ServerPermissions,
) {
    if permissions.is_empty() {
        return;
    }

    resolved
        .server_permissions
        .entry(server_id)
        .and_modify(|existing_permissions| *existing_permissions |= permissions)
        .or_insert(permissions);
}

fn strip_prefix_case_insensitive<'a>(value: &'a str, prefixes: &[&str]) -> Option<&'a str> {
    for prefix in prefixes {
        if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix) {
            return Some(&value[prefix.len()..]);
        }
    }
    None
}

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static BEARER_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!("^Bearer\\s+.+$");

impl DocumentedType for UserAuthentication {
    fn openapi(operations: OperationBuilder) -> OperationBuilder {
        operations.parameter(
            ParameterBuilder::new()
                .name("Authorization")
                .parameter_in(ParameterIn::Header)
                .description(Some("Bearer JWT token"))
                .schema(Some(RefOr::T(Schema::Object(
                    Object::builder()
                        .schema_type(SchemaType::Type(Type::String))
                        .pattern(Some(BEARER_REGEX.as_str().to_owned()))
                        .build(),
                ))))
                .required(Required::False),
        )
    }
}
