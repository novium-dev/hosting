use reqwest::Client;
use serde::Deserialize;

use crate::auth::oauth::lib::CustomProvider;
use crate::config::BackendConfig;

pub(crate) mod lib;

pub(crate) struct AuthService {
    pub(crate) config: BackendConfig,
}

pub enum AuthServiceError {
    AuthMissconfigured,
    InvalidToken,
    UnknownError,
    RequestFailed,
}

#[derive(Deserialize, Debug)]
pub struct AuthUser {
    sub: String,
    email: String,
    email_verified: bool,
    name: String,
    given_name: String,
    preferred_username: String,
    nickname: String,
    groups: Vec<String>,
}

impl AuthService {
    pub fn get_client(&self) -> Result<CustomProvider, AuthServiceError> {
        let redirect_uri = self
            .config
            .public_url
            .clone()
            .join("/auth/callback")
            .map_err(|_err| AuthServiceError::AuthMissconfigured)?
            .to_string();

        let base_url = self.config.auth.url.clone().to_string();
        let auth_url = format!("{}application/o/authorize/", base_url);
        let token_url = format!("{}application/o/token/", base_url);

        Ok(CustomProvider::new(
            auth_url,
            token_url,
            self.config.auth.client_id.clone(),
            self.config.auth.client_secret.clone(),
            redirect_uri,
        ))
    }

    pub async fn get_user(&self, access_token: &str) -> Result<AuthUser, AuthServiceError> {
        let client = Client::new();
        let base_url = &self.config.auth.url;
        let userinfo_url = format!("{base_url}application/o/userinfo/");

        let response = client
            .get(&userinfo_url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| AuthServiceError::RequestFailed)?;

        if response.status() == 401 {
            return Err(AuthServiceError::InvalidToken);
        } else if !response.status().is_success() {
            return Err(AuthServiceError::RequestFailed);
        }

        let user: AuthUser = response
            .json()
            .await
            .map_err(|_| AuthServiceError::RequestFailed)?;
        Ok(user)
    }
}
