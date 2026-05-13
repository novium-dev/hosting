pub mod flow;

use crate::config::AuthConfig;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_misconfigured::FromAuthMisconfigured;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use http::StatusCode;
use oauth2::basic::{BasicClient, BasicRequestTokenError};
use oauth2::{
    AuthorizationCode, Client, CsrfToken, EndpointNotSet, EndpointSet, HttpClientError,
    PkceCodeChallenge, PkceCodeVerifier, Scope, TokenResponse as _,
};
use reqwest::redirect::Policy;
use serde::Deserialize;
use tracing::error;
use url::Url;

#[derive(Clone)]
pub(crate) struct AuthService {
    pub(crate) auth_client:
        BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>,
    pub(crate) http_client: reqwest::Client,
    userinfo_url: Url,
}

impl AuthService {
    pub fn new(config: &AuthConfig) -> Result<Self, anyhow::Error> {
        Ok(Self {
            auth_client: Client::new(config.client_id.clone())
                .set_client_secret(config.client_secret.clone())
                .set_auth_uri(config.auth_url.clone())
                .set_token_uri(config.token_url.clone())
                .set_redirect_uri(config.redirect_url.clone()),
            http_client: reqwest::ClientBuilder::new()
                .redirect(Policy::none())
                .build()?,
            userinfo_url: config.userinfo_url.clone(),
        })
    }
}

#[derive(Deserialize, Debug)]
pub struct AuthUser {
    pub(crate) sub: String,
    pub(crate) email: String,
    email_verified: bool,
    name: String,
    given_name: String,
    pub(crate) preferred_username: String,
    nickname: String,
    groups: Vec<String>,
}

impl AuthService {
    pub async fn get_user<E: FromAuthMisconfigured + FromAuthPermissionDenied + FromAuthInvalid>(
        &self,
        access_token: &str,
    ) -> Result<AuthUser, E> {
        let response = self
            .http_client
            .get(self.userinfo_url.clone())
            .bearer_auth(access_token)
            .send()
            .await
            .inspect_err(|err| error!("Failed to fetch user info: {err:?}"))
            .map_err(|_err| <E as FromAuthMisconfigured>::from())?;

        if response.status() == StatusCode::UNAUTHORIZED {
            Err(<E as FromAuthPermissionDenied>::from())
        } else if !response.status().is_success() {
            error!("Permission denied when fetching user info: {response:?}");
            Err(<E as FromAuthInvalid>::from())
        } else {
            let user: AuthUser = response.json().await.map_err(|err| {
                error!("Failed to parse user info response: {err:?}");
                <E as FromAuthMisconfigured>::from()
            })?;
            Ok(user)
        }
    }

    pub fn generate_url(
        &self,
        scopes: impl IntoIterator<Item = Scope>,
    ) -> (Url, CsrfToken, PkceCodeVerifier) {
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let (auth_url, csrf_token) = self
            .auth_client
            .authorize_url(CsrfToken::new_random)
            .add_scopes(scopes)
            .set_pkce_challenge(pkce_challenge)
            .url();
        (auth_url, csrf_token, pkce_verifier)
    }

    pub async fn request_token(
        &self,
        code: AuthorizationCode,
        verifier: PkceCodeVerifier,
    ) -> Result<String, BasicRequestTokenError<HttpClientError<reqwest::Error>>> {
        Ok(self
            .auth_client
            .exchange_code(code)
            .set_pkce_verifier(verifier)
            .request_async(&self.http_client)
            .await?
            .access_token()
            .secret()
            .clone())
    }
}
