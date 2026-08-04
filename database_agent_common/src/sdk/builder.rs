use crate::sdk::DatabaseAgentSDK;
use core::time::Duration;
use uuid::Uuid;
use zelus::http::HeaderMap;
use zelus::http::header::{AUTHORIZATION, HeaderValue};
use zelus::reqwest::Client;
use zelus::url::Url;

pub trait DatabaseAgentSDKBuilderState: DatabaseAgentSdkSealed {
    type Inner;
}

pub(crate) trait DatabaseAgentSdkSealed {}

pub enum RequiresIdentifier {}
pub enum RequiresBaseURL {}
pub enum RequiresToken {}

impl DatabaseAgentSdkSealed for RequiresIdentifier {}
impl DatabaseAgentSdkSealed for RequiresBaseURL {}
impl DatabaseAgentSdkSealed for RequiresToken {}
impl DatabaseAgentSdkSealed for () {}

impl DatabaseAgentSDKBuilderState for RequiresIdentifier {
    type Inner = ();
}
impl DatabaseAgentSDKBuilderState for RequiresBaseURL {
    type Inner = Uuid;
}
impl DatabaseAgentSDKBuilderState for RequiresToken {
    type Inner = (Uuid, Url);
}
impl DatabaseAgentSDKBuilderState for () {
    type Inner = (Uuid, Url, String);
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum DatabaseAgentSDKError {
    TokenInvalid,
}

impl core::fmt::Display for DatabaseAgentSDKError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(match *self {
            Self::TokenInvalid => "the agent token is not a valid header value",
        })
    }
}

impl core::error::Error for DatabaseAgentSDKError {}

#[must_use]
pub struct DatabaseAgentSDKBuilder<T: DatabaseAgentSDKBuilderState>(T::Inner);

impl DatabaseAgentSDK {
    pub const fn builder() -> DatabaseAgentSDKBuilder<RequiresIdentifier> {
        DatabaseAgentSDKBuilder(())
    }
}

impl DatabaseAgentSDKBuilder<RequiresIdentifier> {
    pub const fn with_identifier(self, identifier: Uuid) -> DatabaseAgentSDKBuilder<RequiresBaseURL> {
        DatabaseAgentSDKBuilder(identifier)
    }
}

impl DatabaseAgentSDKBuilder<RequiresBaseURL> {
    pub fn with_url(self, mut url: Url) -> DatabaseAgentSDKBuilder<RequiresToken> {
        url.set_query(None);
        url.set_fragment(None);
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        DatabaseAgentSDKBuilder((self.0, url))
    }
}

impl DatabaseAgentSDKBuilder<RequiresToken> {
    pub fn with_token(self, token: impl Into<String>) -> DatabaseAgentSDKBuilder<()> {
        DatabaseAgentSDKBuilder((self.0.0, self.0.1, token.into()))
    }
}

impl DatabaseAgentSDKBuilder<()> {
    pub fn build(self) -> Result<DatabaseAgentSDK, DatabaseAgentSDKError> {
        let (identifier, base_url, token) = self.0;

        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_err| DatabaseAgentSDKError::TokenInvalid)?;
        authorization.set_sensitive(true);

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, authorization);

        Ok(DatabaseAgentSDK {
            client: Client::builder()
                .default_headers(headers)
                .timeout(Duration::from_mins(2))
                .build()
                .map_err(|_err| DatabaseAgentSDKError::TokenInvalid)?,
            identifier,
            base_url,
        })
    }
}
