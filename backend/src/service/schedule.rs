use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::{ManagementPermissions, ServerPermissions};
use crate::db::server::ServerId;
use crate::service::schedule::schedule_service_error::{
    CreateScheduleError, DeleteScheduleError, ListSchedulesError, UpdateScheduleError,
};
use crate::service::*;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use core::str::FromStr as _;
use cron::Schedule;
use daemon_common::service::schedule::schedule_service_error::{
    CreateScheduleError as NodeCreateScheduleError, DeleteScheduleError as NodeDeleteScheduleError,
    ListSchedulesError as NodeListSchedulesError, UpdateScheduleError as NodeUpdateScheduleError,
};
use daemon_common::service::schedule::{SchedulePayload, ScheduleRunPolicy, ScheduleStep};
use serde::{Deserialize, Serialize};
use tracing::error;
use zelus::service;

const MAX_SERVER_SCHEDULES: usize = 10;
const MAX_SCHEDULE_STEPS: usize = 32;
const MAX_SCHEDULE_NAME: usize = 64;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ScheduleInfo {
    pub(crate) id: u32,
    pub(crate) name: String,
    pub(crate) enabled: bool,
    pub(crate) policy: ScheduleRunPolicy,
    pub(crate) schedule: String,
    pub(crate) timezone: String,
    pub(crate) steps: Vec<ScheduleStep>,
    pub(crate) next_run: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
pub(crate) struct SchedulePayloadRequest {
    pub(crate) name: String,
    pub(crate) enabled: bool,
    pub(crate) policy: ScheduleRunPolicy,
    pub(crate) schedule: String,
    pub(crate) timezone: String,
    pub(crate) steps: Vec<ScheduleStep>,
}

fn normalize_cron(expression: &str) -> String {
    let fields = expression.split_whitespace().count();
    if fields == 5 {
        format!("0 {}", expression.trim())
    } else {
        expression.trim().to_owned()
    }
}

fn next_run(expression: &str, timezone: &str) -> Option<DateTime<Utc>> {
    let schedule = Schedule::from_str(expression).ok()?;
    let timezone = Tz::from_str(timezone).ok()?;

    schedule
        .upcoming(timezone)
        .next()
        .map(|time| time.with_timezone(&Utc))
}

fn steps_valid(steps: &[ScheduleStep]) -> bool {
    if steps.is_empty() || steps.len() > MAX_SCHEDULE_STEPS {
        return false;
    }

    steps.iter().all(|step| match step {
        ScheduleStep::TerminalCommand { command } => !command.trim().is_empty(),
        ScheduleStep::ContainerCommand { command } => {
            !command.is_empty() && command.iter().any(|part| !part.trim().is_empty())
        }
        ScheduleStep::Start
        | ScheduleStep::Stop
        | ScheduleStep::Restart
        | ScheduleStep::Kill
        | ScheduleStep::Sleep { .. } => true,
    })
}

trait FromSchedulePayload: Sized {
    fn name_invalid() -> Self;
    fn cron_invalid() -> Self;
    fn timezone_invalid() -> Self;
    fn steps_invalid() -> Self;
}

impl SchedulePayloadRequest {
    fn into_node_payload<E: FromSchedulePayload>(self) -> Result<SchedulePayload, E> {
        let name = self.name.trim().to_owned();
        if name.is_empty() || name.chars().count() > MAX_SCHEDULE_NAME {
            return Err(E::name_invalid());
        }

        let schedule = Schedule::from_str(&normalize_cron(&self.schedule))
            .map_err(|_err| E::cron_invalid())?;
        let timezone = Tz::from_str(&self.timezone).map_err(|_err| E::timezone_invalid())?;

        if !steps_valid(&self.steps) {
            return Err(E::steps_invalid());
        }

        Ok(SchedulePayload {
            name,
            enabled: self.enabled,
            policy: self.policy,
            schedule,
            timezone,
            steps: self.steps,
        })
    }
}

#[service(path = "/schedule", tag = "schedule", no_sdk)]
pub(crate) impl ScheduleService for Backend {
    /// Lists the schedules the node runs for this server, with the next time each one fires.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_VIEW`].
    #[route("/{server_id}", method = GET)]
    #[error(auth::{permission_denied, unreachable}, server::not_found, node::failure, db::failure <- [sql:*])]
    async fn list_schedules(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
    ) -> Result<Vec<ScheduleInfo>, _> {
        auth.require::<_, _, ListSchedulesError>(server_id, ServerPermissions::SCHEDULE_VIEW)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(ListSchedulesError::ServerNotFound)?;

        Ok(server
            .node
            .list_schedules(server.node_server_id)
            .await
            .map_err(|err| match err {
                NodeListSchedulesError::ServerNotFound => ListSchedulesError::ServerNotFound,
                NodeListSchedulesError::Communication(_)
                | NodeListSchedulesError::AuthInvalid
                | NodeListSchedulesError::SqlFailure => {
                    error!("Failed to list schedules of server {server_id}: {err:?}");
                    ListSchedulesError::NodeFailure
                }
            })?
            .into_iter()
            .map(|schedule| ScheduleInfo {
                next_run: next_run(&schedule.schedule, &schedule.timezone),
                id: schedule.id,
                name: schedule.name,
                enabled: schedule.enabled,
                policy: schedule.policy,
                schedule: schedule.schedule,
                timezone: schedule.timezone,
                steps: schedule.steps,
            })
            .collect())
    }

    /// Creates a schedule on the server's node and returns its id.
    ///
    /// A cron expression may be given with five fields (minute first) or six (second first);
    /// five-field expressions are stored as running at second zero.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_MANAGE`].
    #[route("/{server_id}", method = PUT)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        schedule::{name_invalid, cron_invalid, timezone_invalid, steps_invalid, limit_exceeded},
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn create_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        payload: SchedulePayloadRequest,
    ) -> Result<u32, _> {
        auth.require::<_, _, CreateScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        let payload = payload.into_node_payload::<CreateScheduleError>()?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(CreateScheduleError::ServerNotFound)?;

        if !auth.has((), ManagementPermissions::LIMITS_BYPASS) {
            let current = server
                .node
                .list_schedules(server.node_server_id)
                .await
                .map_err(|err| match err {
                    NodeListSchedulesError::ServerNotFound => CreateScheduleError::ServerNotFound,
                    NodeListSchedulesError::Communication(_)
                    | NodeListSchedulesError::AuthInvalid
                    | NodeListSchedulesError::SqlFailure => {
                        error!("Failed to count schedules of server {server_id}: {err:?}");
                        CreateScheduleError::NodeFailure
                    }
                })?
                .len();

            if current >= MAX_SERVER_SCHEDULES {
                return Err(CreateScheduleError::ScheduleLimitExceeded);
            }
        }

        server
            .node
            .create_schedule(server.node_server_id, payload)
            .await
            .map_err(|err| match err {
                NodeCreateScheduleError::ServerNotFound => CreateScheduleError::ServerNotFound,
                NodeCreateScheduleError::Communication(_)
                | NodeCreateScheduleError::AuthInvalid
                | NodeCreateScheduleError::SqlFailure => {
                    error!("Failed to create a schedule on server {server_id}: {err:?}");
                    CreateScheduleError::NodeFailure
                }
            })
    }

    /// Replaces a schedule's configuration and steps.
    ///
    /// # Permissions
    /// Requires [`ServerPermissions::SCHEDULE_MANAGE`].
    #[route("/{server_id}/{schedule_id}", method = PATCH)]
    #[error(
        auth::{permission_denied, unreachable},
        server::not_found,
        schedule::{not_found, name_invalid, cron_invalid, timezone_invalid, steps_invalid},
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn update_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        schedule_id: u32,
        payload: SchedulePayloadRequest,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        let payload = payload.into_node_payload::<UpdateScheduleError>()?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(UpdateScheduleError::ServerNotFound)?;

        server
            .node
            .update_schedule(server.node_server_id, schedule_id, payload)
            .await
            .map_err(|err| match err {
                NodeUpdateScheduleError::ServerNotFound => UpdateScheduleError::ServerNotFound,
                NodeUpdateScheduleError::ScheduleNotFound => UpdateScheduleError::ScheduleNotFound,
                NodeUpdateScheduleError::Communication(_)
                | NodeUpdateScheduleError::AuthInvalid
                | NodeUpdateScheduleError::SqlFailure => {
                    error!(
                        "Failed to update schedule {schedule_id} on server {server_id}: {err:?}"
                    );
                    UpdateScheduleError::NodeFailure
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
        node::failure,
        db::failure <- [sql:*]
    )]
    async fn delete_schedule(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        schedule_id: u32,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteScheduleError>(server_id, ServerPermissions::SCHEDULE_MANAGE)?;

        let server = self
            .resolve_server(&*self.database, server_id)
            .await?
            .ok_or(DeleteScheduleError::ServerNotFound)?;

        server
            .node
            .delete_schedule(server.node_server_id, schedule_id)
            .await
            .map_err(|err| match err {
                NodeDeleteScheduleError::ServerNotFound => DeleteScheduleError::ServerNotFound,
                NodeDeleteScheduleError::Communication(_)
                | NodeDeleteScheduleError::AuthInvalid
                | NodeDeleteScheduleError::SqlFailure => {
                    error!(
                        "Failed to delete schedule {schedule_id} on server {server_id}: {err:?}"
                    );
                    DeleteScheduleError::NodeFailure
                }
            })
    }
}

impl FromSchedulePayload for CreateScheduleError {
    fn name_invalid() -> Self {
        Self::ScheduleNameInvalid
    }
    fn cron_invalid() -> Self {
        Self::ScheduleCronInvalid
    }
    fn timezone_invalid() -> Self {
        Self::ScheduleTimezoneInvalid
    }
    fn steps_invalid() -> Self {
        Self::ScheduleStepsInvalid
    }
}

impl FromSchedulePayload for UpdateScheduleError {
    fn name_invalid() -> Self {
        Self::ScheduleNameInvalid
    }
    fn cron_invalid() -> Self {
        Self::ScheduleCronInvalid
    }
    fn timezone_invalid() -> Self {
        Self::ScheduleTimezoneInvalid
    }
    fn steps_invalid() -> Self {
        Self::ScheduleStepsInvalid
    }
}
