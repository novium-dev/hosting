use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use serde::Serialize;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstancePolicy {
    pub(crate) can_create_project: bool,
    pub(crate) can_update_project: bool,
    pub(crate) can_upload_project_logo: bool,
}

#[service(path = "/instance", tag = "instance", no_sdk)]
pub(crate) impl InstanceService for Backend {
    /// Lists the self-service actions this instance allows the caller.
    ///
    /// An action the instance withdraws stays available to callers holding
    /// [`ManagementPermissions::LIMITS_BYPASS`]. Owning the project is checked
    /// separately, when the action itself is performed.
    #[route("/policy", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn instance_policy(&self, #[special] auth: Authentication) -> Result<InstancePolicy, _> {
        let can_bypass_limits = auth.has((), ManagementPermissions::LIMITS_BYPASS);
        let policy = self.config.projects;

        Ok(InstancePolicy {
            can_create_project: policy.self_creation || can_bypass_limits,
            can_update_project: policy.self_update || can_bypass_limits,
            can_upload_project_logo: self.config.logos.upload.is_some(),
        })
    }
}
