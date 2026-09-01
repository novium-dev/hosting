use super::*;
use crate::Backend;
use crate::auth::Authentication;
use serde::Serialize;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstancePolicy {
    pub(crate) self_project_creation: bool,
    pub(crate) self_project_update: bool,
}

#[service(path = "/instance", tag = "instance", no_sdk)]
pub(crate) impl InstanceService for Backend {
    /// Lists the instance-wide self-service policy flags.
    ///
    /// A flag that is off restricts the action to users holding
    /// [`crate::auth::permissions::ManagementPermissions::LIMITS_BYPASS`].
    #[route("/policy", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn instance_policy(&self, #[special] _auth: Authentication) -> Result<InstancePolicy, _> {
        Ok(InstancePolicy {
            self_project_creation: self.config.projects.self_creation,
            self_project_update: self.config.projects.self_update,
        })
    }
}
