use crate::auth::oauth::lib::CustomProvider;
use crate::config::BackendConfig;

pub(crate) mod lib;

pub(crate) struct AuthService {
    pub(crate) config: BackendConfig,
}

pub enum AuthServiceError {
    AuthMissconfigured,
}

impl AuthService {
    pub fn get_client(&self) -> Result<CustomProvider, AuthServiceError> {
        let redirect_uri = self.config.public_url.clone().join("/auth/callback")
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
}