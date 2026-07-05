use reqwest::{Client, Url};
use serde::Deserialize;

use crate::templates::games::minecraft::MinecraftTemplate;
use crate::{
    service::{
        error_resource_invalid_payload::FromResourceInvalidPayload,
        error_resource_missing::FromResourceMissing,
        error_resource_provider_error::FromResourceProviderError,
        error_resource_provider_unavailable::FromResourceProviderUnavailable,
        error_resource_wrong_template::FromResourceWrongTemplate,
    },
    templates::Template as _,
};

mod modrinth;

#[derive(Deserialize, utoipa::ToSchema)]
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
            + FromResourceWrongTemplate
            + FromResourceProviderUnavailable
            + FromResourceProviderError
            + FromResourceMissing,
    >(
        &self,
        template: &str,
        client: &Client,
    ) -> Result<(Url, String), E> {
        match self {
            Self::Modrinth { version, .. } => {
                if template != MinecraftTemplate::ID {
                    return Err(<E as FromResourceWrongTemplate>::from());
                }
                modrinth::resolve_to_url(client, version.clone()).await
            }
        }
    }

    pub const fn r#type(&self) -> ResourceType {
        let Self::Modrinth { r#type, .. } = self;
        *r#type
    }
}

#[derive(Deserialize, Copy, Clone, utoipa::ToSchema)]
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
