pub mod flow;

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
use std::collections::HashMap;
use tracing::error;
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
        }
    }
}

#[derive(Deserialize, Debug)]
pub struct AuthUser {
    pub(crate) sub: String,
    pub(crate) email: String,
    email_verified: bool,
    name: String,
    #[serde(default)]
    pub(crate) given_name: Option<String>,
    #[serde(default)]
    pub(crate) family_name: Option<String>,
    #[serde(default)]
    pub(crate) preferred_username: Option<String>,
    #[serde(default)]
    pub(crate) username: Option<String>,
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
        } else {
            let user: AuthUser = response.json().await.map_err(|err| {
                error!("Failed to parse user info response: {err:?}");
                <E as FromAuthFailure>::from()
            })?;
            Ok(user)
        }
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
