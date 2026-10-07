use crate::auth::permissions::{ManagementPermissions, ProjectPermissions, ServerPermissions};
use sqlx::{Connection as _, PgPool, query};
use tracing::info;

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
    PermissionBackfill {
        id: "server_deploy",
        granted: ManagementPermissions::SERVER_DEPLOY.bits(),
        required: ManagementPermissions::SERVER_MANAGE.bits(),
    },
];

pub async fn apply_permission_backfills(database: &PgPool) -> Result<(), sqlx::Error> {
    for backfill in PERMISSION_BACKFILLS {
        let mut conn = database.acquire().await?;
        let applied = conn
            .transaction(|tx| {
                Box::pin(async move {
                    let claimed = query!(
                        "INSERT INTO permission_backfills (id) VALUES ($1) ON CONFLICT DO NOTHING",
                        backfill.id
                    )
                    .execute(&mut **tx)
                    .await?
                    .rows_affected();

                    if claimed == 0 {
                        return Ok::<_, sqlx::Error>(None);
                    }

                    let projects = query!(
                        r#"UPDATE project_users SET permissions = permissions | $1
                           WHERE permissions & $2 = $2 AND permissions & $1 <> $1"#,
                        backfill.granted,
                        backfill.required
                    )
                    .execute(&mut **tx)
                    .await?
                    .rows_affected();

                    let api_keys = query!(
                        r#"UPDATE api_keys SET permissions = permissions | $1
                           WHERE permissions & $2 = $2 AND permissions & $1 <> $1"#,
                        backfill.granted,
                        backfill.required
                    )
                    .execute(&mut **tx)
                    .await?
                    .rows_affected();

                    Ok(Some((projects, api_keys)))
                })
            })
            .await?;

        if let Some((projects, api_keys)) = applied {
            info!(
                "Applied the {} permission backfill to {projects} project grants and {api_keys} api keys",
                backfill.id
            );
        }
    }

    Ok(())
}
