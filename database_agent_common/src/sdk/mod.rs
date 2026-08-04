pub mod builder;

use crate::service::database::DatabaseServiceClientImpl;
use crate::service::instance::InstanceServiceClientImpl;
use crate::service::system::SystemServiceClientImpl;
use crate::service::user::UserServiceClientImpl;
use crate::service::{
    DatabaseAgentServices, DatabaseAgentServicesClientImpl, DatabaseAgentServicesURL,
};
use uuid::Uuid;
use zelus::reqwest::Client;
use zelus::sdk::ZelusClientImpl;
use zelus::url::Url;

#[derive(Debug, Clone)]
#[must_use]
pub struct DatabaseAgentSDK {
    client: Client,
    identifier: Uuid,
    base_url: Url,
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
impl DatabaseAgentServicesClientImpl for DatabaseAgentSDK {}
impl DatabaseAgentServices for DatabaseAgentSDK {}
impl DatabaseAgentServicesURL for DatabaseAgentSDK {}
