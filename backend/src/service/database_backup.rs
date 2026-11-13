use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ProjectPermissions};
use crate::cluster::JOB_LOCK_TTL;
use crate::db::database::ProjectInstance;
use crate::db::project::ProjectId;
use crate::db::server::schedule::{next_run, normalize_cron, parse_cron};
use crate::service::database::agent_failure;
use crate::service::database_backup::database_backup_service_error::{
    CreateDatabaseBackupError, DeleteDatabaseBackupError, DeleteDatabaseBackupJobError,
    DownloadDatabaseBackupError, ListDatabaseBackupsError, RestoreDatabaseBackupError,
    SetDatabaseBackupJobError, UpdateDatabaseBackupError,
};
use crate::service::error_database_agent_error::FromDatabaseAgentError;
use crate::service::error_database_backup_unsupported::FromDatabaseBackupUnsupported;
use crate::service::error_database_instance_not_found::FromDatabaseInstanceNotFound;
use crate::service::error_database_not_found::FromDatabaseNotFound;
use axum_extra::headers::{ContentDisposition, Header as _};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use core::str::FromStr as _;
use core::time::Duration;
use daemon_common::service::backup::{BackupRetention, RetentionCandidate};
use database_agent_common::service::FileResponse;
use database_agent_common::service::backup::BackupService as _;
use database_agent_common::service::backup::backup_service_error::{
    CreateDatabaseBackupError as AgentCreateError, DeleteDatabaseBackupError as AgentDeleteError,
    DownloadDatabaseBackupError as AgentDownloadError, ListDatabaseBackupsError as AgentListError,
    RestoreDatabaseBackupError as AgentRestoreError, UpdateDatabaseBackupError as AgentUpdateError,
};
use database_agent_common::service::database::DatabaseService as _;
use database_agent_common::types::{BackupOperation, DatabaseType, StoredBackup};
use serde::{Deserialize, Serialize};
use sqlx::query;
use sqlx::types::Json;
use uuid::Uuid;
use zelus::http::HeaderValue;
use zelus::{define_query_variable, service};

const JOB_LOCK: &str = "database_backup_jobs";
const JOB_INTERVAL: Duration = Duration::from_secs(30);
const MAX_CRON_LENGTH: usize = 128;

define_query_variable!(name "The name to give the backup");
define_query_variable!(protected "Whether the backup is exempt from retention policies");

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct DatabaseBackupList {
    /// The backups, newest first.
    pub(crate) backups: Vec<StoredBackup>,
    /// The backup or restore currently running for the database, if any.
    pub(crate) running: Option<BackupOperation>,
    /// How many backups the database may keep.
    pub(crate) limit: u32,
    pub(crate) job: Option<DatabaseBackupJob>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct DatabaseBackupJob {
    pub(crate) enabled: bool,
    pub(crate) cron: String,
    pub(crate) timezone: String,
    pub(crate) retention: BackupRetention,
    pub(crate) next_run: Option<DateTime<Utc>>,
    pub(crate) last_run: Option<DateTime<Utc>>,
    /// Why the last automatic backup could not be started, if it failed.
    pub(crate) last_error: Option<JobError>,
}

#[derive(Debug, Copy, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum JobError {
    /// Another backup or restore was running, so the run was skipped.
    Busy,
    /// The instance was not running.
    Offline,
    /// The database no longer exists.
    DatabaseMissing,
    /// The database agent rejected the backup.
    Agent,
}

impl JobError {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Busy => "busy",
            Self::Offline => "offline",
            Self::DatabaseMissing => "database_missing",
            Self::Agent => "agent",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        [
            Self::Busy,
            Self::Offline,
            Self::DatabaseMissing,
            Self::Agent,
        ]
        .into_iter()
        .find(|error| error.as_str() == value)
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct DatabaseBackupJobRequest {
    pub(crate) enabled: bool,
    pub(crate) cron: String,
    pub(crate) timezone: String,
    /// Applied to all of the database's backups after every automatic backup.
    /// Protected backups are exempt.
    pub(crate) retention: BackupRetention,
}

const fn dump_extension(kind: DatabaseType) -> &'static str {
    match kind {
        DatabaseType::Postgres | DatabaseType::Mariadb => "sql",
        DatabaseType::Mongodb => "archive",
        DatabaseType::Redis => "rdb",
    }
}

fn attachment(file_name: &str) -> Option<ContentDisposition> {
    let value = HeaderValue::from_str(&format!("attachment; filename=\"{file_name}\"")).ok()?;
    ContentDisposition::decode(&mut core::iter::once(&value)).ok()
}

fn require_backups<E: FromDatabaseBackupUnsupported>(instance: &ProjectInstance) -> Result<(), E> {
    if instance.kind.has_named_databases() {
        Ok(())
    } else {
        Err(<E as FromDatabaseBackupUnsupported>::from())
    }
}

fn agent_list_failure<E>(err: AgentListError) -> E
where
    E: FromDatabaseAgentError
        + FromDatabaseInstanceNotFound
        + FromDatabaseBackupUnsupported
        + FromDatabaseNotFound,
{
    match err {
        AgentListError::InstanceNotFound => <E as FromDatabaseInstanceNotFound>::from(),
        AgentListError::InstanceUnsupported => <E as FromDatabaseBackupUnsupported>::from(),
        AgentListError::DatabaseNotFound => <E as FromDatabaseNotFound>::from(),
        other => agent_failure(&other),
    }
}

impl Backend {
    fn backup_limit(&self, instance: &ProjectInstance) -> u32 {
        instance
            .backup_limit
            .unwrap_or(self.config.databases.backup_limit)
    }

    async fn backup_job(
        &self,
        instance: Uuid,
        database: Uuid,
    ) -> Result<Option<DatabaseBackupJob>, sqlx::Error> {
        Ok(query!(
            r#"SELECT enabled, cron, timezone, retention AS "retention: Json<BackupRetention>",
                   next_run, last_run, last_error
               FROM database_backup_jobs
               WHERE instance = $1 AND database = $2"#,
            instance,
            database
        )
        .fetch_optional(&*self.database)
        .await?
        .map(|row| DatabaseBackupJob {
            enabled: row.enabled,
            cron: row.cron,
            timezone: row.timezone,
            retention: row.retention.0,
            next_run: row.next_run,
            last_run: row.last_run,
            last_error: row.last_error.as_deref().and_then(JobError::parse),
        }))
    }

    pub(crate) async fn delete_backup_job(
        &self,
        instance: Uuid,
        database: Uuid,
    ) -> Result<(), sqlx::Error> {
        query!(
            "DELETE FROM database_backup_jobs WHERE instance = $1 AND database = $2",
            instance,
            database
        )
        .execute(&*self.database)
        .await?;
        Ok(())
    }

    pub(crate) fn spawn_database_backup_jobs(&self) {
        let backend = self.clone();

        tokio::task::spawn(async move {
            loop {
                if backend.try_lock(JOB_LOCK, JOB_LOCK_TTL).await {
                    let guard = backend.hold_lock(JOB_LOCK.to_owned());

                    if let Err(err) = backend.run_database_backup_jobs().await {
                        tracing::error!("Unable to run the database backup jobs: {err:?}");
                    }

                    drop(guard);
                    backend.release_lock(JOB_LOCK).await;
                }

                tokio::time::sleep(JOB_INTERVAL).await;
            }
        });
    }

    async fn run_database_backup_jobs(&self) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        let jobs = query!(
            r#"SELECT database_backup_jobs.instance, database_backup_jobs.database,
                   database_backup_jobs.cron, database_backup_jobs.timezone,
                   database_backup_jobs.retention AS "retention: Json<BackupRetention>",
                   database_backup_jobs.next_run, database_backup_jobs.prune_pending,
                   database_instances.host
               FROM database_backup_jobs
               JOIN database_instances ON database_instances.id = database_backup_jobs.instance
               WHERE database_backup_jobs.enabled
                 AND (database_backup_jobs.prune_pending OR database_backup_jobs.next_run <= $1)"#,
            now
        )
        .fetch_all(&*self.database)
        .await?;

        for job in jobs {
            let Some(host) = self.database_host(job.host).await else {
                continue;
            };
            if host.maintenance {
                continue;
            }

            let listing = match host
                .sdk
                .list_database_backups(job.instance, job.database)
                .await
            {
                Ok(listing) => listing,
                Err(err) => {
                    tracing::warn!(
                        "Unable to list the backups of {}/{}: {err:?}",
                        job.instance,
                        job.database
                    );
                    continue;
                }
            };

            let mut prune_pending = job.prune_pending;
            if prune_pending && listing.running.is_none() {
                let retention = job.retention.0;
                let candidates: Vec<RetentionCandidate> = listing
                    .backups
                    .iter()
                    .map(|backup| RetentionCandidate {
                        id: backup.time,
                        protected: backup.protected,
                    })
                    .collect();

                let mut pruned = true;
                for backup_id in retention.apply(&candidates).remove {
                    match host
                        .sdk
                        .delete_database_backup(job.instance, job.database, backup_id)
                        .await
                    {
                        Ok(()) | Err(AgentDeleteError::BackupNotFound) => {}
                        Err(err) => {
                            pruned = false;
                            tracing::warn!(
                                "Unable to prune backup {backup_id} of {}/{}: {err:?}",
                                job.instance,
                                job.database
                            );
                        }
                    }
                }
                prune_pending = !pruned;
            }

            let due = job.next_run.is_some_and(|next| next <= now);
            let mut last_error: Option<Option<JobError>> = None;
            if due {
                if listing.running.is_some() {
                    last_error = Some(Some(JobError::Busy));
                } else {
                    match host
                        .sdk
                        .create_database_backup(job.instance, job.database, None)
                        .await
                    {
                        Ok(_) => {
                            prune_pending = true;
                            last_error = Some(None);
                        }
                        Err(err) => {
                            tracing::warn!(
                                "Unable to start the automatic backup of {}/{}: {err:?}",
                                job.instance,
                                job.database
                            );
                            last_error = Some(Some(match err {
                                AgentCreateError::InstanceOffline => JobError::Offline,
                                AgentCreateError::BackupBusy => JobError::Busy,
                                AgentCreateError::DatabaseNotFound => JobError::DatabaseMissing,
                                _ => JobError::Agent,
                            }));
                        }
                    }
                }
            }

            let upcoming = if due {
                next_run(&job.cron, &job.timezone)
            } else {
                job.next_run
            };

            query!(
                r#"UPDATE database_backup_jobs
                   SET prune_pending = $3,
                       next_run = $4,
                       last_run = CASE WHEN $5 THEN $6 ELSE last_run END,
                       last_error = CASE WHEN $7 THEN $8 ELSE last_error END
                   WHERE instance = $1 AND database = $2"#,
                job.instance,
                job.database,
                prune_pending,
                upcoming,
                due,
                now,
                last_error.is_some(),
                last_error.flatten().map(JobError::as_str)
            )
            .execute(&*self.database)
            .await?;
        }

        Ok(())
    }
}

#[service(
    path = "/project/{project_id}/instance/{instance_id}/database/{database_id}/backup",
    tag = "database",
    no_sdk
)]
pub(crate) impl DatabaseBackupService for Backend {
    /// Lists the backups of a database together with its backup limit and its
    /// automatic backup job.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, backup_unsupported, agent_error},
        db::failure <- [sql:*])]
    async fn list_database_backups(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<DatabaseBackupList, _> {
        auth.require::<_, _, ListDatabaseBackupsError>(
            project_id,
            ProjectPermissions::DATABASE_VIEW,
        )?;

        let instance = self
            .require_instance::<ListDatabaseBackupsError>(project_id, instance_id)
            .await?;
        require_backups::<ListDatabaseBackupsError>(&instance)?;

        let listing = instance
            .host
            .sdk
            .list_database_backups(instance.id, database_id)
            .await
            .map_err(agent_list_failure::<ListDatabaseBackupsError>)?;

        Ok(DatabaseBackupList {
            backups: listing.backups,
            running: listing.running,
            limit: self.backup_limit(&instance),
            job: self.backup_job(instance.id, database_id).await?,
        })
    }

    /// Starts a backup of the database. The backup runs in the background and
    /// is listed once it completed.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`]. The backup limit does
    /// not apply with [`ManagementPermissions::LIMITS_BYPASS`].
    #[route("", method = PUT, query = [ name ])]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, offline, backup_unsupported,
            backup_limit_exceeded, backup_busy, agent_error},
        db::failure <- [sql:*])]
    async fn create_database_backup(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
        name: Option<String>,
    ) -> Result<i64, _> {
        auth.require::<_, _, CreateDatabaseBackupError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<CreateDatabaseBackupError>(project_id, instance_id)
            .await?;
        require_backups::<CreateDatabaseBackupError>(&instance)?;

        if !auth.has((), ManagementPermissions::LIMITS_BYPASS) {
            let listing = instance
                .host
                .sdk
                .list_database_backups(instance.id, database_id)
                .await
                .map_err(agent_list_failure::<CreateDatabaseBackupError>)?;

            let current = u64::try_from(listing.backups.len()).unwrap_or(u64::MAX);
            if current >= u64::from(self.backup_limit(&instance)) {
                return Err(CreateDatabaseBackupError::DatabaseBackupLimitExceeded);
            }
        }

        instance
            .host
            .sdk
            .create_database_backup(instance.id, database_id, name)
            .await
            .map_err(|err| match err {
                AgentCreateError::InstanceNotFound => {
                    CreateDatabaseBackupError::DatabaseInstanceNotFound
                }
                AgentCreateError::InstanceOffline => CreateDatabaseBackupError::DatabaseOffline,
                AgentCreateError::InstanceUnsupported => {
                    CreateDatabaseBackupError::DatabaseBackupUnsupported
                }
                AgentCreateError::DatabaseNotFound => CreateDatabaseBackupError::DatabaseNotFound,
                AgentCreateError::BackupBusy => CreateDatabaseBackupError::DatabaseBackupBusy,
                other => agent_failure(&other),
            })
    }

    /// Downloads a backup as a zstd-compressed dump.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{backup_id}", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, backup_unsupported, agent_error},
        backup::not_found, db::failure <- [sql:*])]
    async fn download_database_backup(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<FileResponse, _> {
        auth.require::<_, _, DownloadDatabaseBackupError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DownloadDatabaseBackupError>(project_id, instance_id)
            .await?;
        require_backups::<DownloadDatabaseBackupError>(&instance)?;

        let database = instance
            .host
            .sdk
            .get_database(instance.id, database_id)
            .await
            .map_err(|err| {
                tracing::debug!("Unable to read the database {database_id}: {err:?}");
                DownloadDatabaseBackupError::DatabaseNotFound
            })?;

        let response = instance
            .host
            .sdk
            .download_database_backup(instance.id, database_id, backup_id)
            .await
            .map_err(|err| match err {
                AgentDownloadError::InstanceNotFound => {
                    DownloadDatabaseBackupError::DatabaseInstanceNotFound
                }
                AgentDownloadError::InstanceUnsupported => {
                    DownloadDatabaseBackupError::DatabaseBackupUnsupported
                }
                AgentDownloadError::DatabaseNotFound => {
                    DownloadDatabaseBackupError::DatabaseNotFound
                }
                AgentDownloadError::BackupNotFound => DownloadDatabaseBackupError::BackupNotFound,
                other => agent_failure(&other),
            })?;

        let FileResponse::Header { stream, .. } = response else {
            return Err(agent_failure(&"the agent sent an unexpected response"));
        };

        let file_name = format!(
            "{}-{backup_id}.{}.zst",
            database.name,
            dump_extension(instance.kind)
        );

        Ok(FileResponse::Header {
            stream,
            disposition: attachment(&file_name),
            r#type: None,
        })
    }

    /// Renames a backup or changes whether it is protected. A `null` field is
    /// left untouched and an empty `name` removes the name. Protected backups
    /// are never removed by automatic backups.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{backup_id}", method = PATCH, query = [ name, protected ])]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, backup_unsupported, agent_error},
        backup::not_found, db::failure <- [sql:*])]
    async fn update_database_backup(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
        name: Option<String>,
        protected: Option<bool>,
    ) -> Result<StoredBackup, _> {
        auth.require::<_, _, UpdateDatabaseBackupError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<UpdateDatabaseBackupError>(project_id, instance_id)
            .await?;
        require_backups::<UpdateDatabaseBackupError>(&instance)?;

        instance
            .host
            .sdk
            .update_database_backup(instance.id, database_id, backup_id, name, protected)
            .await
            .map_err(|err| match err {
                AgentUpdateError::InstanceNotFound => {
                    UpdateDatabaseBackupError::DatabaseInstanceNotFound
                }
                AgentUpdateError::InstanceUnsupported => {
                    UpdateDatabaseBackupError::DatabaseBackupUnsupported
                }
                AgentUpdateError::DatabaseNotFound => UpdateDatabaseBackupError::DatabaseNotFound,
                AgentUpdateError::BackupNotFound => UpdateDatabaseBackupError::BackupNotFound,
                other => agent_failure(&other),
            })
    }

    /// Deletes a backup.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{backup_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, backup_unsupported, agent_error},
        backup::not_found, db::failure <- [sql:*])]
    async fn delete_database_backup(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteDatabaseBackupError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DeleteDatabaseBackupError>(project_id, instance_id)
            .await?;
        require_backups::<DeleteDatabaseBackupError>(&instance)?;

        instance
            .host
            .sdk
            .delete_database_backup(instance.id, database_id, backup_id)
            .await
            .map_err(|err| match err {
                AgentDeleteError::InstanceNotFound => {
                    DeleteDatabaseBackupError::DatabaseInstanceNotFound
                }
                AgentDeleteError::InstanceUnsupported => {
                    DeleteDatabaseBackupError::DatabaseBackupUnsupported
                }
                AgentDeleteError::DatabaseNotFound => DeleteDatabaseBackupError::DatabaseNotFound,
                AgentDeleteError::BackupNotFound => DeleteDatabaseBackupError::BackupNotFound,
                other => agent_failure(&other),
            })
    }

    /// Wipes the database and restores the backup into it. The restore runs in
    /// the background; the backup listing reports it as running until it ends.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/{backup_id}/restore", method = POST)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, offline, backup_unsupported, backup_busy,
            agent_error},
        backup::not_found, db::failure <- [sql:*])]
    async fn restore_database_backup(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
        backup_id: i64,
    ) -> Result<(), _> {
        auth.require::<_, _, RestoreDatabaseBackupError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<RestoreDatabaseBackupError>(project_id, instance_id)
            .await?;
        require_backups::<RestoreDatabaseBackupError>(&instance)?;

        instance
            .host
            .sdk
            .restore_database_backup(instance.id, database_id, backup_id)
            .await
            .map_err(|err| match err {
                AgentRestoreError::InstanceNotFound => {
                    RestoreDatabaseBackupError::DatabaseInstanceNotFound
                }
                AgentRestoreError::InstanceOffline => RestoreDatabaseBackupError::DatabaseOffline,
                AgentRestoreError::InstanceUnsupported => {
                    RestoreDatabaseBackupError::DatabaseBackupUnsupported
                }
                AgentRestoreError::DatabaseNotFound => RestoreDatabaseBackupError::DatabaseNotFound,
                AgentRestoreError::BackupNotFound => RestoreDatabaseBackupError::BackupNotFound,
                AgentRestoreError::BackupBusy => RestoreDatabaseBackupError::DatabaseBackupBusy,
                other => agent_failure(&other),
            })
    }

    /// Creates or replaces the database's automatic backup job.
    ///
    /// The job takes a backup on the cron schedule and then prunes the
    /// database's backups with the retention policy, keeping protected backups.
    /// The policy must keep at least one backup and at most the backup limit.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`]. The backup limit does
    /// not apply with [`ManagementPermissions::LIMITS_BYPASS`].
    #[route("/job", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found,
        database::{instance_not_found, not_found, backup_unsupported, backup_retention_invalid,
            agent_error},
        schedule::{cron_invalid, timezone_invalid}, db::failure <- [sql:*])]
    async fn set_database_backup_job(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
        payload: DatabaseBackupJobRequest,
    ) -> Result<DatabaseBackupJob, _> {
        auth.require::<_, _, SetDatabaseBackupJobError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let cron = normalize_cron(&payload.cron);
        if cron.len() > MAX_CRON_LENGTH || parse_cron(&cron).is_none() {
            return Err(SetDatabaseBackupJobError::ScheduleCronInvalid);
        }
        let timezone = payload.timezone.trim().to_owned();
        if Tz::from_str(&timezone).is_err() {
            return Err(SetDatabaseBackupJobError::ScheduleTimezoneInvalid);
        }

        let instance = self
            .require_instance::<SetDatabaseBackupJobError>(project_id, instance_id)
            .await?;
        require_backups::<SetDatabaseBackupJobError>(&instance)?;

        let bypass = auth.has((), ManagementPermissions::LIMITS_BYPASS);
        let limit = u64::from(self.backup_limit(&instance));
        let within_limit = payload
            .retention
            .max_kept()
            .is_some_and(|kept| bypass || kept <= limit);
        if !within_limit {
            return Err(SetDatabaseBackupJobError::DatabaseBackupRetentionInvalid);
        }

        instance
            .host
            .sdk
            .get_database(instance.id, database_id)
            .await
            .map_err(|err| {
                tracing::debug!("Unable to read the database {database_id}: {err:?}");
                SetDatabaseBackupJobError::DatabaseNotFound
            })?;

        let upcoming = payload
            .enabled
            .then(|| next_run(&cron, &timezone))
            .flatten();

        query!(
            r#"INSERT INTO database_backup_jobs
                   (instance, database, enabled, cron, timezone, retention, next_run)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (instance, database) DO UPDATE
               SET enabled = EXCLUDED.enabled, cron = EXCLUDED.cron,
                   timezone = EXCLUDED.timezone, retention = EXCLUDED.retention,
                   next_run = EXCLUDED.next_run"#,
            instance.id,
            database_id,
            payload.enabled,
            cron,
            timezone,
            Json(payload.retention) as _,
            upcoming
        )
        .execute(&*self.database)
        .await?;

        self.backup_job(instance.id, database_id)
            .await?
            .ok_or_else(|| agent_failure(&"the backup job vanished after saving it"))
    }

    /// Removes the database's automatic backup job. Existing backups are kept.
    ///
    /// # Permissions
    /// Requires [`ProjectPermissions::DATABASE_MANAGE`].
    #[route("/job", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, project::not_found, database::instance_not_found,
        db::failure <- [sql:*])]
    async fn delete_database_backup_job(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteDatabaseBackupJobError>(
            project_id,
            ProjectPermissions::DATABASE_MANAGE,
        )?;

        let instance = self
            .require_instance::<DeleteDatabaseBackupJobError>(project_id, instance_id)
            .await?;

        self.delete_backup_job(instance.id, database_id).await?;
        Ok(())
    }
}
