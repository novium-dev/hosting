use crate::auth::permissions::{ProjectPermissions, ServerPermissions};
use sqlx::{PgPool, query};
use tracing::info;

/// A permission that did not exist yet when older grants were made, together
/// with the permission a grant has to hold already to receive it.
///
/// Grants are stored as bitmasks in `project_users` and `api_keys`, so a
/// permission added later is missing from every grant made before it and the
/// feature it gates reads as denied. Each entry here is applied once and then
/// recorded, so a permission revoked afterwards stays revoked.
pub struct PermissionBackfill {
    pub id: &'static str,
    pub granted: i64,
    pub required: i64,
}

pub const PERMISSION_BACKFILLS: &[PermissionBackfill] = &[
    PermissionBackfill {
        id: "schedule_view",
        granted: ServerPermissions::SCHEDULE_VIEW.bits(),
        required: ProjectPermissions::VIEW.bits(),
    },
    PermissionBackfill {
        id: "schedule_manage",
        granted: ServerPermissions::SCHEDULE_MANAGE.bits(),
        required: ServerPermissions::POWER.bits(),
    },
];

pub async fn apply_permission_backfills(database: &PgPool) -> Result<(), sqlx::Error> {
    for backfill in PERMISSION_BACKFILLS {
        let mut tx = database.begin().await?;

        let claimed = query!(
            "INSERT INTO permission_backfills (id) VALUES ($1) ON CONFLICT DO NOTHING",
            backfill.id
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();

        if claimed == 0 {
            tx.rollback().await?;
            continue;
        }

        let projects = query!(
            r#"UPDATE project_users SET permissions = permissions | $1
               WHERE permissions & $2 = $2 AND permissions & $1 <> $1"#,
            backfill.granted,
            backfill.required
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();

        let api_keys = query!(
            r#"UPDATE api_keys SET permissions = permissions | $1
               WHERE permissions & $2 = $2 AND permissions & $1 <> $1"#,
            backfill.granted,
            backfill.required
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();

        tx.commit().await?;

        info!(
            "Applied the {} permission backfill to {projects} project grants and {api_keys} api keys",
            backfill.id
        );
    }

    Ok(())
}
