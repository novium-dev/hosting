use crate::Backend;
use crate::auth::BEARER_REGEX;
use crate::auth::permissions::{
    HasPermission, ManagementPermissions, Permission, ServerPermissions,
};
use crate::db::server::ServerId;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_unreachable::FromAuthUnreachable;
use axum::Extension;
use axum::extract::FromRequestParts as _;
use axum_extra::TypedHeader;
use axum_extra::headers::Authorization;
use axum_extra::headers::authorization::Bearer;
use core::str::FromStr as _;
use http::request::Parts;
use jsonwebtoken::{Algorithm, TokenData, Validation, decode, decode_header};
use serde::{Deserialize, Serialize};
use sqlx::query;
use std::collections::HashMap;
use tracing::error;
use utoipa::openapi::path::{OperationBuilder, ParameterBuilder, ParameterIn};
use utoipa::openapi::schema::SchemaType;
use utoipa::openapi::{Object, RefOr, Required, Schema, Type};
use uuid::Uuid;
use zelus::special::{FromRequestParts, OptionalFromRequestParts};
use zelus::types::DocumentedType;

#[derive(Debug)]
pub struct UserAuthentication {
    pub id: Uuid,
    name: Option<String>,
    email: Option<String>,
    permissions: i64,
    servers: HashMap<ServerId, ServerPermissions>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Claims {
    sub: Uuid,
    iss: String,
    exp: usize,
    #[serde(default)]
    iat: Option<usize>,
    #[serde(default)]
    id: Option<Uuid>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default, rename = "emailVerified")]
    email_verified: Option<bool>,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    orgs: Vec<OrgClaim>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OrgClaim {
    id: Uuid,
    #[serde(default)]
    permissions: Vec<PermissionClaim>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PermissionClaim {
    resource: String,
    action: String,
}

#[derive(Default)]
struct ResolvedPermissions {
    org_permissions: HashMap<Uuid, ServerPermissions>,
    server_permissions: HashMap<ServerId, ServerPermissions>,
}

#[derive(Clone)]
enum PermissionScope {
    Org(Uuid),
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

        let Some(TypedHeader(Authorization(bearer))) =
            <Option<TypedHeader<Authorization<Bearer>>>>::from_request_parts(parts, &())
                .await
                .map_err(|_err| <E as FromAuthInvalid>::from())?
        else {
            return Ok(None);
        };

        let claims = decode_claims::<E>(bearer.token(), &backend).await?;
        let global_permissions = global_permissions_from_claims(&claims.permissions);
        let mut resolved = resolve_permissions(&claims);
        apply_server_permission_restrictions::<E>(
            &backend,
            &mut resolved,
            global_permissions.contains(ManagementPermissions::SERVER_MANAGE),
        )
        .await?;

        Ok(Some(Self {
            id: claims.id.unwrap_or(claims.sub),
            name: claims.name,
            email: claims.email,
            permissions: global_permissions.bits(),
            servers: resolved.server_permissions,
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

async fn decode_claims<E: FromAuthInvalid + FromAuthUnreachable>(
    token: &str,
    backend: &Backend,
) -> Result<Claims, E> {
    let header = decode_header(token).map_err(|err| {
        error!("Unable to decode JWT header: {err}");
        <E as FromAuthInvalid>::from()
    })?;
    let Some(kid) = header.kid.as_deref() else {
        error!("Missing kid in JWT header");
        return Err(<E as FromAuthInvalid>::from());
    };

    let keyset = backend.jwks_storage.fetch::<E>().await?;

    let decoding_key = if let Some(jwk) = keyset.keys.get(kid) {
        jwk.decoding_key.clone()
    } else {
        let refreshed = backend.jwks_storage.refresh::<E>().await?;
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

async fn apply_server_permission_restrictions<E: From<sqlx::Error> + FromAuthInvalid>(
    backend: &Backend,
    resolved: &mut ResolvedPermissions,
    can_manage_servers: bool,
) -> Result<(), E> {
    if resolved.org_permissions.is_empty() && resolved.server_permissions.is_empty() {
        return Ok(());
    }

    let records = query!(
        "SELECT `id` AS `id: ServerId`, `owner` AS `owner: uuid::fmt::Hyphenated`, `suspended` FROM `servers`"
    )
    .fetch_all(&*backend.database)
    .await
    .map_err(|err| {
        error!("Unable to resolve server permission restrictions: {err:?}");
        <E as From<sqlx::Error>>::from(err)
    })?;

    for record in records {
        if let Some(org_permissions) = resolved
            .org_permissions
            .get(record.owner.as_uuid())
            .copied()
        {
            resolved
                .server_permissions
                .entry(record.id)
                .and_modify(|permissions| *permissions |= org_permissions)
                .or_insert(org_permissions);
        }

        if can_manage_servers || record.suspended == 0 {
            continue;
        }

        if let Some(permissions) = resolved.server_permissions.get_mut(&record.id) {
            *permissions = ServerPermissions::VIEW;
        }
    }

    Ok(())
}

fn apply_org_claim(org: &OrgClaim, resolved: &mut ResolvedPermissions) {
    apply_permissions(&org.permissions, &PermissionScope::Org(org.id), resolved);
}

fn apply_permissions(
    permissions: &[PermissionClaim],
    default_scope: &PermissionScope,
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
    let Some((scope, action)) = permission_scope_and_action(permission, default_scope) else {
        return;
    };

    match scope {
        PermissionScope::Org(org_id) => {
            let permissions = server_permissions_from_action(&action);

            if permissions.is_empty() {
                return;
            }

            resolved
                .org_permissions
                .entry(org_id)
                .and_modify(|existing_permissions| *existing_permissions |= permissions)
                .or_insert(permissions);
        }
        PermissionScope::Server(server_id) => {
            let permissions = server_permissions_from_action(&action);

            if permissions.is_empty() {
                return;
            }

            resolved
                .server_permissions
                .entry(server_id)
                .and_modify(|existing_permissions| *existing_permissions |= permissions)
                .or_insert(permissions);
        }
    }
}

fn permission_scope_and_action(
    permission: &PermissionClaim,
    default_scope: PermissionScope,
) -> Option<(PermissionScope, String)> {
    let action = permission.action.trim().to_ascii_lowercase();
    if action.is_empty() {
        return None;
    }

    let resource = permission.resource.trim();
    if resource == "*" {
        return Some((default_scope, action));
    }

    let Ok(server_id) = ServerId::from_str(resource) else {
        return None;
    };

    Some((PermissionScope::Server(server_id), action))
}

fn server_permissions_from_action(action: &str) -> ServerPermissions {
    ServerPermissions::from_claim_action(action).unwrap_or_default()
}

fn global_permissions_from_claims(claim_permissions: &[String]) -> ManagementPermissions {
    claim_permissions.iter().fold(
        ManagementPermissions::empty(),
        |mut permissions, claim_permission| {
            if let Some(permission) = ManagementPermissions::from_claim_action(claim_permission) {
                permissions |= permission;
            }

            permissions
        },
    )
}

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
