use core::future::Future;
use oauth2::reqwest::async_http_client;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse as _, TokenUrl, basic::BasicClient,
};
use tracing::error;

#[derive(Debug)]
pub enum OauthError {
    TokenRequestFailed,
    AuthUrlCreationFailed,
}

#[derive(Clone)]
pub struct CustomProvider {
    pub auth_url: String,
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_url: String,
    pub state: Option<StateAuth>,
}

#[derive(Clone, Debug)]
pub struct StateAuth {
    pub url_generated: Option<String>,
    pub state: String,
    pub verifier: String,
}

impl CustomProvider {
    pub const fn new(
        auth_url: String,
        token_url: String,
        client_id: String,
        client_secret: String,
        redirect_url: String,
    ) -> Self {
        Self {
            auth_url,
            token_url,
            client_id,
            client_secret,
            redirect_url,
            state: None,
        }
    }

    pub fn get_client(&self) -> Result<BasicClient, OauthError> {
        Ok(BasicClient::new(
            ClientId::new(self.client_id.clone()),
            Some(ClientSecret::new(self.client_secret.clone())),
            AuthUrl::new(self.auth_url.clone())
                .map_err(|_err| OauthError::AuthUrlCreationFailed)?,
            Some(
                TokenUrl::new(self.token_url.clone())
                    .map_err(|_err| OauthError::AuthUrlCreationFailed)?,
            ),
        )
        .set_redirect_uri(
            RedirectUrl::new(self.redirect_url.clone())
                .map_err(|_err| OauthError::AuthUrlCreationFailed)?,
        ))
    }

    pub async fn generate_url<F, Fut>(
        mut self,
        scopes: Vec<String>,
        save: F,
    ) -> Result<Self, OauthError>
    where
        F: FnOnce(StateAuth) -> Fut + Send,
        Fut: Future<Output = ()> + Send,
    {
        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

        let (auth_url, csrf_token) = self
            .get_client()?
            .authorize_url(CsrfToken::new_random)
            .add_scopes(scopes.into_iter().map(Scope::new))
            .set_pkce_challenge(pkce_challenge)
            .url();

        let state = StateAuth {
            url_generated: Some(auth_url.to_string()),
            state: csrf_token.secret().clone(),
            verifier: pkce_verifier.secret().clone(),
        };

        self.state = Some(state.clone());
        save(state).await;

        Ok(self)
    }

    pub async fn generate_token(
        &self,
        code: String,
        verifier: String,
    ) -> Result<String, OauthError> {
        let token = self
            .get_client()?
            .exchange_code(AuthorizationCode::new(code))
            .set_pkce_verifier(PkceCodeVerifier::new(verifier))
            .request_async(async_http_client)
            .await
            .map_err(|err| {
                error!("Token request failed: {err:?}");
                OauthError::TokenRequestFailed
            })?;

        Ok(token.access_token().secret().clone())
    }
}
