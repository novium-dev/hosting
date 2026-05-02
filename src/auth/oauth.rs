use crate::auth::oauth::lib::CustomProvider;
use crate::config::BackendConfig;
use crate::service::error_auth_invalid::FromAuthInvalid;
use crate::service::error_auth_misconfigured::FromAuthMisconfigured;
use crate::service::error_auth_permission_denied::FromAuthPermissionDenied;
use reqwest::Client;
use serde::Deserialize;
use tracing::error;

pub(crate) mod lib;

pub(crate) struct AuthService {
    pub(crate) config: BackendConfig,
}

#[derive(Deserialize, Debug)]
pub struct AuthUser {
    pub(crate) sub: String,
    pub(crate) email: String,
    pub(crate) preferred_username: String,
}

impl AuthService {
    pub fn get_client<E: FromAuthMisconfigured>(&self) -> Result<CustomProvider, E> {
        let redirect_uri = self
            .config
            .public_url
            .join("/auth/callback")
            .map_err(|err| {
                error!("Failed to create redirect URI: {err:?}");
                <E as FromAuthMisconfigured>::from()
            })?
            .to_string();

        let base_url = self.config.auth.url.to_string();
        let auth_url = format!("{base_url}application/o/authorize/");
        let token_url = format!("{base_url}application/o/token/");

        Ok(CustomProvider::new(
            auth_url,
            token_url,
            self.config.auth.client_id.clone(),
            self.config.auth.client_secret.clone(),
            redirect_uri,
        ))
    }

    pub async fn get_user<E: FromAuthMisconfigured + FromAuthPermissionDenied + FromAuthInvalid>(
        &self,
        access_token: &str,
    ) -> Result<AuthUser, E> {
        let client = Client::new();
        let base_url = &self.config.auth.url;
        let userinfo_url = format!("{base_url}application/o/userinfo/");

        let response = client
            .get(&userinfo_url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|err| {
                error!("Failed to fetch user info: {err:?}");
                <E as FromAuthInvalid>::from()
            })?;

        if response.status() == 401 {
            Err(<E as FromAuthInvalid>::from())
        } else if !response.status().is_success() {
            error!("Permission denied when fetching user info: {response:?}");
            Err(<E as FromAuthPermissionDenied>::from())
        } else {
            let user: AuthUser = response.json().await.map_err(|err| {
                error!("Failed to parse user info response: {err:?}");
                <E as FromAuthMisconfigured>::from()
            })?;
            Ok(user)
        }
    }
}
