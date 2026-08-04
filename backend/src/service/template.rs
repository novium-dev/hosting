use super::*;
use crate::Backend;
use crate::service::template::template_service_error::TemplateInfoError;
use crate::templates::variable::VariablePayload;
use crate::templates::{TemplatePortDefinition, ThinTemplateError};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use zelus::error::define_error;
use zelus::service;

define_error!(template {
    not_found ("The template does not exist" NOT_FOUND),
    missing ("The template used in the server does no longer exist" INTERNAL_SERVER_ERROR),
    corrupted ("The template was unable to read the server data" INTERNAL_SERVER_ERROR),
    unavailable ("The template is unavailable at the moment" SERVICE_UNAVAILABLE),
    port_definition_unknown ("Unknown template port definition used" BAD_REQUEST),
    input_invalid ("The template input is invalid" BAD_REQUEST),
});

define_path_variable!(template "The template id");

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
struct TemplateInfo {
    internet_access: bool,
    variables: VariablePayload,
    ports: HashMap<String, TemplatePortDefinition>,
}

#[service(path = "/template", tag = "template", no_sdk)]
pub(crate) impl TemplateService for Backend {
    /// Lists all templates
    #[route("", method = GET)]
    #[error()]
    async fn list_templates(&self) -> Result<HashSet<String>, _> {
        Ok(self.templates.read().await.keys().cloned().collect())
    }

    /// Shows information on a specific template.
    #[route("/{template}", method = GET)]
    #[error(cache::failure <- [redis:*], template::{not_found, unavailable})]
    async fn template_info(&self, template: String) -> Result<TemplateInfo, _> {
        let Some(template) = self.templates.read().await.get(&template).cloned() else {
            return Err(TemplateInfoError::TemplateNotFound);
        };
        Ok(TemplateInfo {
            internet_access: template.default_internet_access(),
            variables: template
                .default_variables(self.cache.clone())
                .await
                .map_err(ThinTemplateError::into::<TemplateInfoError>)?,
            ports: template
                .default_ports()
                .await
                .map_err(ThinTemplateError::into::<TemplateInfoError>)?,
        })
    }
}
