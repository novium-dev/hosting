use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use serde::Serialize;
use zelus::service;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct InstancePolicy {
    pub(crate) create_project: PolicyAccess,
    pub(crate) update_project: PolicyAccess,
    pub(crate) upload_project_logo: PolicyAccess,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PolicyAccess {
    Allowed,
    Bypassed,
    Denied,
}

impl PolicyAccess {
    const fn resolve(allowed: bool, can_bypass: bool) -> Self {
        match (allowed, can_bypass) {
            (true, _) => Self::Allowed,
            (false, true) => Self::Bypassed,
            (false, false) => Self::Denied,
        }
    }
}

#[service(path = "/instance", tag = "instance", no_sdk)]
pub(crate) impl InstanceService for Backend {
    /// Lists the self-service actions this instance allows the caller.
    ///
    /// An action the instance withdraws stays available to callers holding
    /// [`ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS`]; `bypassed` marks an
    /// action that is only allowed through that bypass. Owning the project is checked
    /// separately, when the action itself is performed.
    #[route("/policy", method = GET)]
    #[error(db::failure <- [sql:*], auth::unreachable)]
    async fn instance_policy(&self, #[special] auth: Authentication) -> Result<InstancePolicy, _> {
        let can_bypass = auth.has((), ManagementPermissions::BYPASS_INSTANCE_RESTRICTIONS);
        let policy = self.config.projects;

        Ok(InstancePolicy {
            create_project: PolicyAccess::resolve(policy.self_creation, can_bypass),
            update_project: PolicyAccess::resolve(policy.self_update, can_bypass),
            upload_project_logo: if self.config.logos.upload.is_some() {
                PolicyAccess::resolve(policy.self_update, can_bypass)
            } else {
                PolicyAccess::Denied
            },
        })
    }
}
