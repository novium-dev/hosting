use reqwest::Client;
use serde::Deserialize;

use crate::auth::oauth::lib::CustomProvider;
use crate::config::BackendConfig;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_missconfigured::FromAuthMissconfigured;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;

pub(crate) mod lib;

pub(crate) struct AuthService {
    pub(crate) config: BackendConfig,
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
    pub fn get_client<E: FromAuthMissconfigured>(&self) -> Result<CustomProvider, E> {
        let redirect_uri = self
            .config
            .public_url
            .clone()
            .join("/auth/callback")
            .map_err(|_| E::from())?
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

    pub async fn get_user<E: FromAuthMissconfigured + FromAuthPermissionDenied + FromAuthInvalid>(&self, access_token: &str) -> Result<AuthUser, E> {
        let client = Client::new();
        let base_url = &self.config.auth.url;
        let userinfo_url = format!("{base_url}application/o/userinfo/");

        let response = client
            .get(&userinfo_url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| <E as FromAuthInvalid>::from())?;

        if response.status() == 401 {
            return Err(<E as FromAuthInvalid>::from());
        } else if !response.status().is_success() {
            return Err(<E as FromAuthPermissionDenied>::from());
        }

        let user: AuthUser = response
            .json()
            .await
            .map_err(|_| <E as FromAuthInvalid>::from())?;
        Ok(user)
    }
}
