use crate::Backend;
use crate::auth::permissions::{
    HasPermission, ManagementPermissions, Permission, ServerPermissions,
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
use serde_json::Value;
use sqlx::query;
use std::collections::{HashMap, HashSet};
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
    projects: Vec<String>,
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
    permissions: Vec<PermissionClaim>,
    #[serde(default)]
    projects: Vec<Value>,
    #[serde(default)]
    orgs: Vec<Value>,
    #[serde(default)]
    servers: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum PermissionClaim {
    Entry { resource: String, action: String },
    Action(String),
}

#[derive(Default)]
struct ResolvedPermissions {
    global: i64,
    project_permissions: HashMap<String, ServerPermissions>,
    server_permissions: HashMap<ServerId, ServerPermissions>,
    projects: HashSet<String>,
}

enum PermissionScope {
    Global,
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

        Ok(Some(Self {
            id: claims.id.unwrap_or(claims.sub),
            name: claims.name,
            role: claims.role,
            email: claims.email,
            permissions: resolved.global,
            projects: resolved.projects.into_iter().collect(),
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

    for permission in &claims.permissions {
        apply_permission(permission, PermissionScope::Global, &mut resolved);
    }

    for org in &claims.orgs {
        if let Some(project_id) = pick_string(org, &["organizationId", "projectId", "id"]) {
            resolved.projects.insert(project_id.clone());
            resolved
                .project_permissions
                .entry(project_id)
                .or_insert(ServerPermissions::VIEW);
        }
        apply_permissions_from_object(org, PermissionScope::Global, &mut resolved);
    }

    for project in &claims.projects {
        let scope = pick_string(project, &["projectId", "organizationId", "id"])
            .map_or(PermissionScope::Global, PermissionScope::Project);
        if let PermissionScope::Project(project_id) = &scope {
            resolved.projects.insert(project_id.clone());
            resolved
                .project_permissions
                .entry(project_id.clone())
                .or_insert(ServerPermissions::VIEW);
        }

        apply_permissions_from_object(project, scope, &mut resolved);
        apply_nested_server_permissions(project, &mut resolved);
    }

    for server in &claims.servers {
        let Some(server_id) = pick_server_id(server) else {
            continue;
        };
        apply_permissions_from_object(server, PermissionScope::Server(server_id), &mut resolved);
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

    let records =
        query!("SELECT `id` AS `id: ServerId`, `group` FROM `servers` WHERE `group` IS NOT NULL")
            .fetch_all(&*backend.database)
            .await
            .map_err(|err| {
                error!("Unable to expand project permissions: {err:?}");
                <E as From<sqlx::Error>>::from(err)
            })?;

    for record in records {
        let Some(group) = record.group else {
            continue;
        };
        let Some(project_permissions) = resolved.project_permissions.get(&group).copied() else {
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

fn apply_nested_server_permissions(project: &Value, resolved: &mut ResolvedPermissions) {
    let Some(object) = project.as_object() else {
        return;
    };
    let Some(servers) = object.get("servers").and_then(Value::as_array) else {
        return;
    };

    for server in servers {
        let Some(server_id) = pick_server_id(server) else {
            continue;
        };
        apply_permissions_from_object(server, PermissionScope::Server(server_id), resolved);
    }
}

fn apply_permissions_from_object(
    value: &Value,
    scope: PermissionScope,
    resolved: &mut ResolvedPermissions,
) {
    let Some(object) = value.as_object() else {
        return;
    };
    let Some(permissions) = object.get("permissions").and_then(Value::as_array) else {
        return;
    };

    for permission in permissions {
        if let Ok(permission) = serde_json::from_value::<PermissionClaim>(permission.clone()) {
            apply_permission(&permission, clone_scope(&scope), resolved);
        }
    }
}

fn apply_permission(
    permission: &PermissionClaim,
    default_scope: PermissionScope,
    resolved: &mut ResolvedPermissions,
) {
    let (scope, action) = permission_scope_and_action(permission, default_scope);

    match scope {
        PermissionScope::Global => {
            let management = management_permissions_from_action(&action).bits();
            let server = server_permissions_from_action(&action).bits();
            resolved.global |= management | server;
        }
        PermissionScope::Project(project_id) => {
            resolved.projects.insert(project_id.clone());
            let server_permissions = server_permissions_from_action(&action);
            if !server_permissions.is_empty() {
                resolved
                    .project_permissions
                    .entry(project_id)
                    .and_modify(|permissions| *permissions |= server_permissions)
                    .or_insert(server_permissions);
            }
        }
        PermissionScope::Server(server_id) => {
            let server_permissions = server_permissions_from_action(&action);
            if !server_permissions.is_empty() {
                resolved
                    .server_permissions
                    .entry(server_id)
                    .and_modify(|permissions| *permissions |= server_permissions)
                    .or_insert(server_permissions);
            }
        }
    }
}

fn permission_scope_and_action(
    permission: &PermissionClaim,
    default_scope: PermissionScope,
) -> (PermissionScope, String) {
    match permission {
        PermissionClaim::Entry { resource, action } => {
            let action = normalize_permission(action);
            if let Some(scope) = scope_from_resource(resource) {
                return (scope, action);
            }
            (default_scope, action)
        }
        PermissionClaim::Action(action) => (default_scope, normalize_permission(action)),
    }
}

fn scope_from_resource(resource: &str) -> Option<PermissionScope> {
    let resource = resource.trim();
    if resource == "*" {
        return Some(PermissionScope::Global);
    }

    if let Some(project) = strip_prefix_case_insensitive(
        resource,
        &[
            "project:",
            "project/",
            "project_",
            "organization:",
            "organization/",
            "organization_",
            "org:",
            "org/",
            "org_",
        ],
    ) {
        return Some(PermissionScope::Project(project.to_owned()));
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
    match action {
        "*" => ServerPermissions::all(),
        "view" | "read" => ServerPermissions::VIEW,
        "power" | "start" | "stop" | "restart" | "kill" => ServerPermissions::POWER,
        "terminal" | "terminal_read" | "console_read" => ServerPermissions::TERMINAL_READ,
        "terminal_write" | "console_write" => ServerPermissions::TERMINAL_WRITE,
        "build_view" | "settings_view" => ServerPermissions::BUILD_VIEW,
        "build_edit" | "settings_edit" => ServerPermissions::BUILD_EDIT,
        "files_read" | "file_read" => ServerPermissions::FILES_READ,
        "files_write" | "file_write" => ServerPermissions::FILES_WRITE,
        "backup_view" => ServerPermissions::BACKUP_VIEW,
        "backup_download" => ServerPermissions::BACKUP_DOWNLOAD,
        "backup_create" => ServerPermissions::BACKUP_CREATE,
        "backup_delete" => ServerPermissions::BACKUP_DELETE,
        "backup_restore" => ServerPermissions::BACKUP_RESTORE,
        "user_view" => ServerPermissions::USER_VIEW,
        "user_edit" | "permissions_edit" => ServerPermissions::USER_EDIT,
        "admin_manage" | "admin_management" | "manage" => ServerPermissions::ADMIN_MANAGEMENT,
        _ => ServerPermissions::empty(),
    }
}

fn management_permissions_from_action(action: &str) -> ManagementPermissions {
    match action {
        "*" => ManagementPermissions::all(),
        "server_manage" | "server_edit" | "server_update" => ManagementPermissions::SERVER_MANAGE,
        "server_suspend" => ManagementPermissions::SERVER_SUSPEND,
        "server_delete" => ManagementPermissions::SERVER_DELETE,
        "user_view" => ManagementPermissions::USER_VIEW,
        "user_manage" | "users_manage" => ManagementPermissions::USER_MANAGE,
        "api_keys_view" | "apikeys_view" => ManagementPermissions::API_KEYS_VIEW,
        "api_keys_manage" | "apikeys_manage" => ManagementPermissions::API_KEYS_MANAGE,
        "nodes_view" | "node_view" => ManagementPermissions::NODES_VIEW,
        "nodes_manage" | "node_manage" => ManagementPermissions::NODES_MANAGE,
        "backup_storage_select" => ManagementPermissions::BACKUP_STORAGE_SELECT,
        "network_create" => ManagementPermissions::NETWORK_CREATE,
        "network_delete" => ManagementPermissions::NETWORK_DELETE,
        "database_create" => ManagementPermissions::DATABASE_CREATE,
        "database_delete" => ManagementPermissions::DATABASE_DELETE,
        "limits_bypass" => ManagementPermissions::LIMITS_BYPASS,
        _ => ManagementPermissions::empty(),
    }
}

fn pick_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .find(|value| !value.is_empty())
        .map(str::to_owned)
}

fn pick_server_id(value: &Value) -> Option<ServerId> {
    let id = pick_string(value, &["serverId", "id"])?;
    ServerId::from_str(&id).ok()
}

fn normalize_permission(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            'a'..='z' | '0'..='9' | '*' => normalized.push(character),
            'A'..='Z' => normalized.push(character.to_ascii_lowercase()),
            '-' | '.' | ':' | '/' | ' ' => normalized.push('_'),
            _ => {}
        }
    }
    normalized
}

fn clone_scope(scope: &PermissionScope) -> PermissionScope {
    match scope {
        PermissionScope::Global => PermissionScope::Global,
        PermissionScope::Project(project) => PermissionScope::Project(project.clone()),
        PermissionScope::Server(server) => PermissionScope::Server(*server),
    }
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
