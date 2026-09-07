use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ServerPermissions};
use crate::db::server::schedule::{
    MAX_SCHEDULE_NAME, MAX_SCHEDULE_TASKS, MAX_SERVER_SCHEDULES, SchedulePolicy, ScheduleTask,
    next_run, normalize_cron, parse_cron,
};
use crate::db::server::{Server, ServerId};
use crate::service::schedule::schedule_service_error::{
    CreateScheduleError, DeleteScheduleError, ListSchedulesError, RunScheduleError,
    UpdateScheduleError,
};
use crate::service::*;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use core::str::FromStr as _;
use daemon_common::service::schedule::SchedulePayload;
use daemon_common::service::schedule::schedule_service_error::{
    CreateScheduleError as NodeCreateScheduleError, DeleteScheduleError as NodeDeleteScheduleError,
    RunScheduleError as NodeRunScheduleError, UpdateScheduleError as NodeUpdateScheduleError,
};
use serde::{Deserialize, Serialize};
use sqlx::query;
use sqlx::types::JsonValue;
use tracing::error;
use zelus::service;

const MINECRAFT_FEATURE: &str = "minecraft_commands";

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ScheduleInfo {
    pub(crate) id: i32,
    pub(crate) name: String,
    pub(crate) enabled: bool,
    pub(crate) policy: SchedulePolicy,
    pub(crate) cron: String,
    pub(crate) timezone: String,
    pub(crate) tasks: Vec<ScheduleTask>,
    pub(crate) next_run: Option<DateTime<Utc>>,
    pub(crate) synchronized: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct SchedulePayloadRequest {
    pub(crate) name: String,
    pub(crate) enabled: bool,
    pub(crate) policy: SchedulePolicy,
    pub(crate) cron: String,
    pub(crate) timezone: String,
    pub(crate) tasks: Vec<ScheduleTask>,
}

struct ValidSchedule {
    name: String,
    cron: String,
    timezone: String,
    tasks: Vec<ScheduleTask>,
}

impl ValidSchedule {
    fn node_payload(&self, payload: &SchedulePayloadRequest) -> Option<SchedulePayload> {
        Some(SchedulePayload {
            policy: payload.policy.into(),
            schedule: parse_cron(&self.cron)?,
            timezone: Tz::from_str(&self.timezone).ok()?,
            steps: self
                .tasks
                .iter()
                .cloned()
                .map(ScheduleTask::compile)
                .collect(),
        })
    }
}

trait FromScheduleValidation: Sized {
    fn name_invalid() -> Self;
    fn cron_invalid() -> Self;
    fn timezone_invalid() -> Self;
    fn tasks_invalid() -> Self;
    fn minecraft_unsupported() -> Self;
    fn node_failure() -> Self;
}

impl Backend {
    async fn validate_schedule<E: FromScheduleValidation>(
        &self,
        server: &Server,
        payload: &SchedulePayloadRequest,
    ) -> Result<ValidSchedule, E> {
        let name = payload.name.trim().to_owned();
        if name.is_empty() || name.chars().count() > MAX_SCHEDULE_NAME {
            return Err(E::name_invalid());
        }

        let cron = normalize_cron(&payload.cron);
        if parse_cron(&cron).is_none() {
            return Err(E::cron_invalid());
        }

        let timezone = Tz::from_str(&payload.timezone)
            .map_err(|_err| E::timezone_invalid())?
            .to_string();

        if payload.tasks.is_empty()
            || payload.tasks.len() > MAX_SCHEDULE_TASKS
            || !payload.tasks.iter().all(ScheduleTask::is_complete)
        {
            return Err(E::tasks_invalid());
        }

        if payload.tasks.iter().any(ScheduleTask::requires_minecraft)
            && !server
                .template
                .enabled_features(self.cache.clone(), server.template_extra.clone())
                .await
                .map_err(|err| {
                    error!(
                        "Unable to resolve the features of server {}: {err:?}",
                        server.id
                    );
                    E::node_failure()
                })?
                .contains(MINECRAFT_FEATURE)
        {
            return Err(E::minecraft_unsupported());
        }

        Ok(ValidSchedule {
            name,
            cron,
            timezone,
            tasks: payload.tasks.clone(),
        })
    }

    /// Brings the node's copy of a schedule in line with the panel's record and
    /// answers with the node's id for it, or `None` when the schedule is
    /// disabled and the node should not hold it at all.
    async fn sync_schedule<E: FromScheduleValidation>(
        &self,
        server: &Server,
        enabled: bool,
        node_schedule_id: Option<i32>,
        payload: SchedulePayload,
    ) -> Result<Option<i32>, E> {
        let node_failure = |err: &dyn core::fmt::Debug| {
            error!(
                "The node refused a schedule of server {}: {err:?}",
                server.id
            );
            E::node_failure()
        };

        match (enabled, node_schedule_id) {
            (false, None) => Ok(None),
            (false, Some(id)) => {
                match server
                    .node
                    .delete_schedule(server.node_server_id, id.cast_unsigned())
                    .await
                {
                    Ok(()) | Err(NodeDeleteScheduleError::ServerNotFound) => Ok(None),
                    Err(err) => Err(node_failure(&err)),
                }
            }
            (true, Some(id)) => {
                match server
                    .node
                    .update_schedule(server.node_server_id, id.cast_unsigned(), payload.clone())
                    .await
                {
                    Ok(()) => Ok(Some(id)),
                    Err(NodeUpdateScheduleError::ScheduleNotFound) => {
                        self.create_node_schedule(server, payload).await.map(Some)
                    }
                    Err(err) => Err(node_failure(&err)),
                }
            }
            (true, None) => self.create_node_schedule(server, payload).await.map(Some),
        }
    }

    async fn create_node_schedule<E: FromScheduleValidation>(
        &self,
        server: &Server,
        payload: SchedulePayload,
    ) -> Result<i32, E> {
        server
            .node
            .create_schedule(server.node_server_id, payload)
            .await
            .map(u32::cast_signed)
            .map_err(|err: NodeCreateScheduleError| {
                error!(
                    "The node refused to create a schedule for server {}: {err:?}",
                    server.id
                );
                E::node_failure()
            })
    }
}

#[service(path = "/schedule", tag = "schedule", no_sdk)]
pub(crate) impl ScheduleService for Backend {
    /// Lists the server's schedules, with the next time each enabled one fires.
    ///
    /// `synchronized` is false while the node does not hold the schedule, which
    /// only happens when it is disabled or a previous push failed.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_VIEW`].
    #[route("/{server_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, server::not_found, db::failure <- [sql:*])]
    async fn list_schedules(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Vec<ScheduleInfo>, _> {
        auth.require::<_, _, ListSchedulesError>(server_id, ServerPermissions::SCHEDULE_VIEW)?;

        Ok(query!(
            r#"SELECT
                id,
                node_schedule_id,
                name,
                enabled AS "enabled: bool",
                policy AS "policy: SchedulePolicy",
                cron,
                timezone,
                tasks AS "tasks: JsonValue"
               FROM server_schedules
               WHERE server = $1
               ORDER BY id"#,
            &server_id
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| ScheduleInfo {
            next_run: row
                .enabled
                .then(|| next_run(&row.cron, &row.timezone))
                .flatten(),
            synchronized: row.node_schedule_id.is_some(),
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            policy: row.policy,
            cron: row.cron,
            timezone: row.timezone,
            tasks: serde_json::from_value(row.tasks).unwrap_or_default(),
        })
        .collect())
    }

    /// Creates a schedule and pushes it to the server's node.
    ///
    /// The cron expression may carry five fields (minute first) or six (second
    /// first); a five-field expression is stored as running at second zero.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_MANAGE`], and
    /// [`ManagementPermissions::SERVER_MANAGE`] for a container command task.
    #[route("/{server_id}", method = PUT)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        schedule::{name_invalid, cron_invalid, timezone_invalid, tasks_invalid,
            minecraft_unsupported, limit_exceeded},
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn create_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        payload: SchedulePayloadRequest,
    ) -> Result<i32, _> {
        auth.require::<_, _, CreateScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        if payload
            .tasks
            .iter()
            .any(ScheduleTask::requires_container_access)
        {
            auth.require::<_, _, CreateScheduleError>((), ManagementPermissions::SERVER_MANAGE)?;
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(CreateScheduleError::ServerNotFound)?;

        let valid = self
            .validate_schedule::<CreateScheduleError>(&server, &payload)
            .await?;

        if !auth.has((), ManagementPermissions::LIMITS_BYPASS) {
            let current = query!(
                r#"SELECT count(*) AS "count!" FROM server_schedules WHERE server = $1"#,
                &server_id
            )
            .fetch_one(&*self.database)
            .await?
            .count;

            if current >= MAX_SERVER_SCHEDULES {
                return Err(CreateScheduleError::ScheduleLimitExceeded);
            }
        }

        let node_payload = valid
            .node_payload(&payload)
            .ok_or(CreateScheduleError::ScheduleCronInvalid)?;
        let node_schedule_id = self
            .sync_schedule::<CreateScheduleError>(&server, payload.enabled, None, node_payload)
            .await?;

        let tasks = serde_json::to_value(&valid.tasks).unwrap_or_default();
        let schedule = query!(
            r#"INSERT INTO server_schedules
                (server, node_schedule_id, name, enabled, policy, cron, timezone, tasks)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id"#,
            &server_id,
            node_schedule_id,
            valid.name,
            payload.enabled,
            payload.policy as SchedulePolicy,
            valid.cron,
            valid.timezone,
            tasks,
        )
        .fetch_one(&*self.database)
        .await;

        match schedule {
            Ok(row) => Ok(row.id),
            Err(err) => {
                if let Some(id) = node_schedule_id
                    && let Err(cleanup) = server
                        .node
                        .delete_schedule(server.node_server_id, id.cast_unsigned())
                        .await
                {
                    error!("Unable to remove the orphaned node schedule: {cleanup:?}");
                }

                Err(err.into())
            }
        }
    }

    /// Replaces a schedule's configuration and steps.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_MANAGE`], and
    /// [`ManagementPermissions::SERVER_MANAGE`] for a container command task.
    #[route("/{server_id}/{schedule_id}", method = PATCH)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        schedule::{not_found, name_invalid, cron_invalid, timezone_invalid, tasks_invalid,
            minecraft_unsupported},
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn update_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        schedule_id: i32,
        payload: SchedulePayloadRequest,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        if payload
            .tasks
            .iter()
            .any(ScheduleTask::requires_container_access)
        {
            auth.require::<_, _, UpdateScheduleError>((), ManagementPermissions::SERVER_MANAGE)?;
        }

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateScheduleError::ServerNotFound)?;

        let current = query!(
            "SELECT node_schedule_id FROM server_schedules WHERE id = $1 AND server = $2",
            schedule_id,
            &server_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(UpdateScheduleError::ScheduleNotFound)?;

        let valid = self
            .validate_schedule::<UpdateScheduleError>(&server, &payload)
            .await?;

        let node_payload = valid
            .node_payload(&payload)
            .ok_or(UpdateScheduleError::ScheduleCronInvalid)?;
        let node_schedule_id = self
            .sync_schedule::<UpdateScheduleError>(
                &server,
                payload.enabled,
                current.node_schedule_id,
                node_payload,
            )
            .await?;

        let tasks = serde_json::to_value(&valid.tasks).unwrap_or_default();
        query!(
            r#"UPDATE server_schedules
               SET node_schedule_id = $1, name = $2, enabled = $3, policy = $4,
                   cron = $5, timezone = $6, tasks = $7
               WHERE id = $8 AND server = $9"#,
            node_schedule_id,
            valid.name,
            payload.enabled,
            payload.policy as SchedulePolicy,
            valid.cron,
            valid.timezone,
            tasks,
            schedule_id,
            &server_id,
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }

    /// Runs a schedule's steps on the node right now, whatever its cron says.
    ///
    /// The run policy is not consulted, so the steps run even when the server is
    /// in a state an unattended run would have skipped. The node executes them
    /// in the background; this answers as soon as it has accepted the request.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_MANAGE`].
    #[route("/{server_id}/{schedule_id}/run", method = POST)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        schedule::{not_found, not_synchronized},
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn run_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        schedule_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, RunScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(RunScheduleError::ServerNotFound)?;

        let node_schedule_id = query!(
            "SELECT node_schedule_id FROM server_schedules WHERE id = $1 AND server = $2",
            schedule_id,
            &server_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(RunScheduleError::ScheduleNotFound)?
        .node_schedule_id
        .ok_or(RunScheduleError::ScheduleNotSynchronized)?;

        server
            .node
            .run_schedule(server.node_server_id, node_schedule_id.cast_unsigned())
            .await
            .map_err(|err| match err {
                NodeRunScheduleError::ServerNotFound => RunScheduleError::ServerNotFound,
                NodeRunScheduleError::ScheduleNotFound => RunScheduleError::ScheduleNotFound,
                NodeRunScheduleError::Communication(_)
                | NodeRunScheduleError::AuthInvalid
                | NodeRunScheduleError::SqlFailure => {
                    error!("The node refused to run schedule {schedule_id}: {err:?}");
                    RunScheduleError::NodeFailure
                }
            })
    }

    /// Deletes a schedule and stops the node from running it.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_MANAGE`].
    #[route("/{server_id}/{schedule_id}", method = DELETE)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        schedule::not_found,
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn delete_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        schedule_id: i32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DeleteScheduleError::ServerNotFound)?;

        let current = query!(
            "SELECT node_schedule_id FROM server_schedules WHERE id = $1 AND server = $2",
            schedule_id,
            &server_id
        )
        .fetch_optional(&*self.database)
        .await?
        .ok_or(DeleteScheduleError::ScheduleNotFound)?;

        if let Some(id) = current.node_schedule_id {
            match server
                .node
                .delete_schedule(server.node_server_id, id.cast_unsigned())
                .await
            {
                Ok(()) | Err(NodeDeleteScheduleError::ServerNotFound) => {}
                Err(err) => {
                    error!("The node refused to delete schedule {schedule_id}: {err:?}");
                    return Err(DeleteScheduleError::NodeFailure);
                }
            }
        }

        query!(
            "DELETE FROM server_schedules WHERE id = $1 AND server = $2",
            schedule_id,
            &server_id
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }
}

impl FromScheduleValidation for CreateScheduleError {
    fn name_invalid() -> Self {
        Self::ScheduleNameInvalid
    }
    fn cron_invalid() -> Self {
        Self::ScheduleCronInvalid
    }
    fn timezone_invalid() -> Self {
        Self::ScheduleTimezoneInvalid
    }
    fn tasks_invalid() -> Self {
        Self::ScheduleTasksInvalid
    }
    fn minecraft_unsupported() -> Self {
        Self::ScheduleMinecraftUnsupported
    }
    fn node_failure() -> Self {
        Self::NodeFailure
    }
}

impl FromScheduleValidation for UpdateScheduleError {
    fn name_invalid() -> Self {
        Self::ScheduleNameInvalid
    }
    fn cron_invalid() -> Self {
        Self::ScheduleCronInvalid
    }
    fn timezone_invalid() -> Self {
        Self::ScheduleTimezoneInvalid
    }
    fn tasks_invalid() -> Self {
        Self::ScheduleTasksInvalid
    }
    fn minecraft_unsupported() -> Self {
        Self::ScheduleMinecraftUnsupported
    }
    fn node_failure() -> Self {
        Self::NodeFailure
    }
}
