use reqwest::{Client, Url};
use serde::Deserialize;

use crate::service::{
    error_resource_invalid_payload::FromResourceInvalidPayload,
    error_resource_provider_error::FromResourceProviderError,
    error_resource_provider_unavailable::FromResourceProviderUnavailable,
    error_resource_resource_missing::FromResourceResourceMissing,
};

mod modrinth;

#[derive(Deserialize)]
#[serde(tag = "provider")]
pub enum Resource {
    #[serde(rename = "modrinth")]
    Modrinth {
        #[serde(rename = "type")]
        r#type: ResourceType,
        version: String,
    },
}

impl Resource {
    pub(crate) async fn resolve_to_url<
        E: FromResourceInvalidPayload
            + FromResourceProviderUnavailable
            + FromResourceProviderError
            + FromResourceResourceMissing,
    >(
        &self,
        client: &Client,
    ) -> Result<(Url, String), E> {
        match self {
            Self::Modrinth { version, .. } => {
                modrinth::resolve_to_url(client, version.clone()).await
            }
        }
    }

    pub const fn r#type(&self) -> ResourceType {
        let Self::Modrinth { r#type, .. } = self;
        *r#type
    }
}

#[derive(Deserialize, Copy, Clone)]
pub enum ResourceType {
    #[serde(rename = "plugin")]
    Plugin,
    #[serde(rename = "modification")]
    Modification,
    #[serde(rename = "data_pack")]
    DataPack,
}

impl ResourceType {
    pub const fn path_prefix(self) -> &'static str {
        match self {
            Self::Plugin => "plugins/",
            Self::Modification => "mods/",
            Self::DataPack => "world/datapacks",
        }
    }
}
