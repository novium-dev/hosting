pub mod flow;

use crate::auth::permissions::Role;
use crate::config::{AuthConfig, OAuthProviderConfig};
use crate::service::error_auth_failure::FromAuthFailure;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use http::StatusCode;
use oauth2::basic::BasicClient;
use oauth2::{
    AuthorizationCode, Client, CsrfToken, EndpointNotSet, EndpointSet, PkceCodeChallenge,
    PkceCodeVerifier, Scope, TokenResponse as _,
};
use reqwest::redirect::Policy;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use tracing::{debug, error};
use url::Url;

type OAuthClient =
    BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

#[derive(Clone)]
pub(crate) struct AuthService {
    providers: HashMap<String, OAuthProvider>,
    pub(crate) http_client: reqwest::Client,
}

#[derive(Clone)]
struct OAuthProvider {
    auth_client: OAuthClient,
    userinfo_url: Url,
    admin_roles: HashSet<String>,
    moderator_roles: HashSet<String>,
}

impl AuthService {
    pub fn new(config: &AuthConfig) -> Result<Self, anyhow::Error> {
        let providers = config
            .providers
            .iter()
            .map(|(name, config)| (name.clone(), OAuthProvider::new(config)))
            .collect();

        Ok(Self {
            providers,
            http_client: reqwest::ClientBuilder::new()
                .redirect(Policy::none())
                .build()?,
        })
    }

    fn provider<E: FromAuthFailure>(&self, provider: &str) -> Result<&OAuthProvider, E> {
        self.providers
            .get(provider)
            .ok_or_else(<E as FromAuthFailure>::from)
    }
}

impl OAuthProvider {
    fn new(config: &OAuthProviderConfig) -> Self {
        Self {
            auth_client: Client::new(config.client_id.clone())
                .set_client_secret(config.client_secret.clone())
                .set_auth_uri(config.auth_url.clone())
                .set_token_uri(config.token_url.clone())
                .set_redirect_uri(config.redirect_url.clone()),
            userinfo_url: config.userinfo_url.clone(),
            admin_roles: config.admin_roles.clone(),
            moderator_roles: config.moderator_roles.clone(),
        }
    }

    fn map_role(&self, roles: &[String]) -> Role {
        let mut mapped = Role::User;
        for role in roles.iter().map(|role| role.to_lowercase()) {
            if self.admin_roles.contains(&role) {
                return Role::Admin;
            }
            if self.moderator_roles.contains(&role) {
                mapped = Role::Moderator;
            }
        }
        mapped
    }

    fn maps_roles(&self) -> bool {
        !self.admin_roles.is_empty() || !self.moderator_roles.is_empty()
    }
}

#[derive(Deserialize, Debug)]
pub struct AuthUser {
    pub(crate) sub: String,
    pub(crate) email: String,
    #[serde(default)]
    pub(crate) given_name: Option<String>,
    #[serde(default)]
    pub(crate) family_name: Option<String>,
    #[serde(default)]
    pub(crate) preferred_username: Option<String>,
    #[serde(default)]
    pub(crate) picture: Option<String>,
    #[serde(default)]
    pub(crate) username: Option<String>,
    #[serde(default)]
    pub(crate) roles: Option<Vec<String>>,
}

impl AuthService {
    pub async fn get_user<E: FromAuthFailure + FromAuthPermissionDenied + FromAuthInvalid>(
        &self,
        provider: &str,
        access_token: &str,
    ) -> Result<AuthUser, E> {
        let provider = self.provider::<E>(provider)?;

        let response = self
            .http_client
            .get(provider.userinfo_url.clone())
            .bearer_auth(access_token)
            .send()
            .await
            .inspect_err(|err| error!("Failed to fetch user info: {err:?}"))
            .map_err(|_err| <E as FromAuthFailure>::from())?;

        if response.status() == StatusCode::UNAUTHORIZED {
            Err(<E as FromAuthPermissionDenied>::from())
        } else if !response.status().is_success() {
            error!("Permission denied when fetching user info: {response:?}");
            Err(<E as FromAuthInvalid>::from())
        } else {let body = response.text().await.map_err(|err| {
            error!("Failed to read user info response: {err:?}");
            <E as FromAuthFailure>::from()
        })?;
            debug!("User info response: {}", body);

            let user: AuthUser = serde_json::from_str(&body).map_err(|err| {
                error!("Failed to parse user info response: {err:?}");
                <E as FromAuthFailure>::from()
            })?;

            Ok(user)
        }
    }

    pub fn role_for<E: FromAuthFailure>(
        &self,
        provider: &str,
        roles: Option<&[String]>,
    ) -> Result<Option<Role>, E> {
        let provider = self.provider::<E>(provider)?;

        if !provider.maps_roles() {
            return Ok(None);
        }

        Ok(roles.map(|roles| provider.map_role(roles)))
    }

    pub fn generate_url<E: FromAuthFailure>(
        &self,
        provider: &str,
        scopes: impl IntoIterator<Item = Scope>,
    ) -> Result<(Url, CsrfToken, PkceCodeVerifier), E> {
        let provider = self.provider::<E>(provider)?;
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let (auth_url, csrf_token) = provider
            .auth_client
            .authorize_url(CsrfToken::new_random)
            .add_scopes(scopes)
            .set_pkce_challenge(pkce_challenge)
            .url();
        Ok((auth_url, csrf_token, pkce_verifier))
    }

    pub async fn request_token<E: FromAuthFailure>(
        &self,
        provider: &str,
        code: AuthorizationCode,
        verifier: PkceCodeVerifier,
    ) -> Result<String, E> {
        let provider = self.provider::<E>(provider)?;

        Ok(provider
            .auth_client
            .exchange_code(code)
            .set_pkce_verifier(verifier)
            .request_async(&self.http_client)
            .await
            .inspect_err(|err| error!("Failed to generate access token: {err:?}"))
            .map_err(|_err| <E as FromAuthFailure>::from())?
            .access_token()
            .secret()
            .clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};

    #[test]
    fn ignores_null_claims_the_backend_does_not_use() {
        let user: AuthUser = serde_json::from_str(
            r#"{"sub":"abc","email_verified":true,"name":null,"email":"user@example.com","given_name":null,"picture":null}"#,
        )
        .expect("user info should deserialize");

        assert_eq!(user.sub, "abc");
        assert_eq!(user.email, "user@example.com");
        assert_eq!(user.given_name, None);
        assert_eq!(user.picture, None);
        assert_eq!(user.roles, None);
    }

    fn provider(admin: &[&str], moderator: &[&str]) -> OAuthProvider {
        OAuthProvider::new(&OAuthProviderConfig {
            auth_url: AuthUrl::new("https://sso.example.com/oidc/auth".to_owned())
                .expect("valid url"),
            token_url: TokenUrl::new("https://sso.example.com/oidc/token".to_owned())
                .expect("valid url"),
            redirect_url: RedirectUrl::new(
                "https://panel.example.com/api/auth/callback".to_owned(),
            )
            .expect("valid url"),
            userinfo_url: Url::parse("https://sso.example.com/oidc/me").expect("valid url"),
            client_id: ClientId::new("client".to_owned()),
            client_secret: ClientSecret::new("secret".to_owned()),
            admin_roles: admin.iter().map(|role| (*role).to_owned()).collect(),
            moderator_roles: moderator.iter().map(|role| (*role).to_owned()).collect(),
        })
    }

    #[test]
    fn maps_the_highest_matching_role() {
        let provider = provider(&["panel-admin"], &["panel-moderator"]);

        assert_eq!(
            provider.map_role(&["panel-moderator".to_owned(), "panel-admin".to_owned()]),
            Role::Admin
        );
        assert_eq!(
            provider.map_role(&["panel-moderator".to_owned()]),
            Role::Moderator
        );
        assert_eq!(
            provider.map_role(&["something-else".to_owned()]),
            Role::User
        );
        assert_eq!(provider.map_role(&[]), Role::User);
    }

    #[test]
    fn matches_role_names_case_insensitively() {
        let provider = provider(&["panel-admin"], &[]);

        assert_eq!(provider.map_role(&["Panel-Admin".to_owned()]), Role::Admin);
    }

    #[test]
    fn leaves_roles_alone_without_a_mapping() {
        assert!(!provider(&[], &[]).maps_roles());
        assert!(provider(&[], &["panel-moderator"]).maps_roles());
    }
}
