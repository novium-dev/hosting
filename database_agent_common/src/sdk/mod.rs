pub mod builder;

use crate::service::database::DatabaseServiceClientImpl;
use crate::service::instance::InstanceServiceClientImpl;
use crate::service::integrity::IntegrityServiceClientImpl;
use crate::service::setup::SetupServiceClientImpl;
use crate::service::system::SystemServiceClientImpl;
use crate::service::user::UserServiceClientImpl;
use crate::service::{
    DatabaseAgentServices, DatabaseAgentServicesClientImpl, DatabaseAgentServicesURL,
};
use core::error::Error;
use http::Uri;
use uuid::Uuid;
use zelus::reqwest::Client;
use zelus::reqwest::tls::{DnsName, ResolveServerName, ServerName};
use zelus::sdk::ZelusClientImpl;
use zelus::url::Url;

pub(crate) struct DatabaseAgentSDKServerNameResolver(pub Uuid);

impl ResolveServerName for DatabaseAgentSDKServerNameResolver {
    fn resolve(&self, _uri: &Uri) -> Result<ServerName, Box<dyn Error + Sync + Send>> {
        Ok(ServerName::DnsName(DnsName::try_from(format!(
            "node-{}",
            self.0
        ))?))
    }
}

#[derive(Debug, Clone)]
#[must_use]
pub struct DatabaseAgentSDK {
    pub(crate) client: Client,
    pub(crate) identifier: Uuid,
    pub(crate) base_url: Url,
}

impl DatabaseAgentSDK {
    #[must_use]
    pub const fn id(&self) -> Uuid {
        self.identifier
    }
}

impl ZelusClientImpl for DatabaseAgentSDK {
    fn client(&self) -> &Client {
        &self.client
    }

    fn base_url(&self) -> &Url {
        &self.base_url
    }
}

impl InstanceServiceClientImpl for DatabaseAgentSDK {}
impl DatabaseServiceClientImpl for DatabaseAgentSDK {}
impl UserServiceClientImpl for DatabaseAgentSDK {}
impl SystemServiceClientImpl for DatabaseAgentSDK {}
impl IntegrityServiceClientImpl for DatabaseAgentSDK {}
impl SetupServiceClientImpl for DatabaseAgentSDK {}
impl DatabaseAgentServicesClientImpl for DatabaseAgentSDK {}
impl DatabaseAgentServices for DatabaseAgentSDK {}
impl DatabaseAgentServicesURL for DatabaseAgentSDK {}
