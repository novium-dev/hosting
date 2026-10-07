use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};

pub const KNOWN_PERMISSIONS: i64 = ProjectPermissions::all().bits()
    | ServerPermissions::all().bits()
    | ManagementPermissions::all().bits();

struct ImpliedPermission {
    permission: i64,
    implied_by: i64,
}

const IMPLIED_PERMISSIONS: &[ImpliedPermission] = &[
    ImpliedPermission {
        permission: ServerPermissions::SCHEDULE_VIEW.bits(),
        implied_by: ProjectPermissions::VIEW.bits(),
    },
    ImpliedPermission {
        permission: ServerPermissions::SCHEDULE_MANAGE.bits(),
        implied_by: ServerPermissions::POWER.bits(),
    },
    ImpliedPermission {
        permission: ManagementPermissions::SERVER_DEPLOY.bits(),
        implied_by: ManagementPermissions::SERVER_MANAGE.bits(),
    },
];

#[must_use]
pub fn resolve_grant(permissions: i64, known: i64) -> i64 {
    IMPLIED_PERMISSIONS
        .iter()
        .fold(permissions & known, |resolved, implied| {
            let unknown = implied.permission & !known;
            if unknown != 0 && resolved & implied.implied_by == implied.implied_by {
                resolved | unknown
            } else {
                resolved
            }
        })
}
