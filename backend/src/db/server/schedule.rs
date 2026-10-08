use crate::utils::server::rcon_command;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use core::str::FromStr as _;
use cron::Schedule;
use daemon_common::service::backup::BackupRetention;
use daemon_common::service::schedule::{ScheduleRunPolicy, ScheduleStep};
use serde::{Deserialize, Serialize};

pub const MAX_SERVER_SCHEDULES: i64 = 10;
pub const MAX_SCHEDULE_TASKS: usize = 32;
pub const MAX_SCHEDULE_NAME: usize = 64;

#[derive(
    Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "schedule_policy", rename_all = "lowercase")]
pub enum SchedulePolicy {
    #[serde(rename = "always")]
    Always,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "stopped")]
    Stopped,
}

impl From<SchedulePolicy> for ScheduleRunPolicy {
    fn from(policy: SchedulePolicy) -> Self {
        match policy {
            SchedulePolicy::Always => Self::Always,
            SchedulePolicy::Running => Self::Running,
            SchedulePolicy::Stopped => Self::Stopped,
        }
    }
}

/// A step as the panel stores it.
///
/// Everything the node understands is passed through untouched; the variants
/// beyond that are the panel's own, and [`ScheduleTask::compile`] lowers them
/// onto the primitives a node can run.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(tag = "type")]
pub enum ScheduleTask {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "stop")]
    Stop,
    #[serde(rename = "restart")]
    Restart,
    #[serde(rename = "kill")]
    Kill,
    #[serde(rename = "sleep")]
    Sleep { time: u64 },
    #[serde(rename = "terminal")]
    TerminalCommand { command: String },
    #[serde(rename = "container")]
    ContainerCommand { command: Vec<String> },
    #[serde(rename = "minecraft")]
    MinecraftCommand { command: String },
    #[serde(rename = "backup")]
    Backup {
        #[serde(default)]
        storage: Option<String>,
        #[serde(default)]
        retention: Option<BackupRetention>,
    },
    #[serde(rename = "prune")]
    Prune {
        #[serde(default)]
        storage: Option<String>,
        retention: BackupRetention,
    },
}

impl ScheduleTask {
    pub fn compile(self) -> ScheduleStep {
        match self {
            Self::Start => ScheduleStep::Start,
            Self::Stop => ScheduleStep::Stop,
            Self::Restart => ScheduleStep::Restart,
            Self::Kill => ScheduleStep::Kill,
            Self::Sleep { time } => ScheduleStep::Sleep { time },
            Self::TerminalCommand { command } => ScheduleStep::TerminalCommand { command },
            Self::ContainerCommand { command } => ScheduleStep::ContainerCommand { command },
            Self::MinecraftCommand { command } => ScheduleStep::ContainerCommand {
                command: rcon_command(
                    command
                        .trim()
                        .trim_start_matches('/')
                        .split_whitespace()
                        .map(str::to_owned),
                ),
            },
            Self::Backup { storage, retention } => ScheduleStep::Backup { storage, retention },
            Self::Prune { storage, retention } => ScheduleStep::Prune { storage, retention },
        }
    }

    pub const fn requires_minecraft(&self) -> bool {
        matches!(self, Self::MinecraftCommand { .. })
    }

    pub const fn requires_container_access(&self) -> bool {
        matches!(self, Self::ContainerCommand { .. })
    }

    pub const fn runs_console_commands(&self) -> bool {
        matches!(
            self,
            Self::TerminalCommand { .. } | Self::MinecraftCommand { .. }
        )
    }

    pub const fn creates_backups(&self) -> bool {
        matches!(self, Self::Backup { .. })
    }

    pub const fn selects_backup_storage(&self) -> bool {
        matches!(
            self,
            Self::Backup {
                storage: Some(_),
                ..
            } | Self::Prune {
                storage: Some(_),
                ..
            }
        )
    }

    pub const fn removes_backups(&self) -> bool {
        match self {
            Self::Backup { retention, .. } => match retention {
                Some(retention) => !retention.is_noop(),
                None => false,
            },
            Self::Prune { retention, .. } => !retention.is_noop(),
            Self::Start
            | Self::Stop
            | Self::Restart
            | Self::Kill
            | Self::Sleep { .. }
            | Self::TerminalCommand { .. }
            | Self::ContainerCommand { .. }
            | Self::MinecraftCommand { .. } => false,
        }
    }

    pub const fn exceeds_backup_limit(&self, limit: u32) -> bool {
        let Self::Backup { retention, .. } = self else {
            return false;
        };

        match retention {
            Some(retention) => match retention.max_kept() {
                Some(kept) => kept > limit as u64,
                None => true,
            },
            None => true,
        }
    }

    pub fn is_complete(&self) -> bool {
        match self {
            Self::TerminalCommand { command } | Self::MinecraftCommand { command } => {
                !command.trim().is_empty()
            }
            Self::ContainerCommand { command } => {
                command.iter().any(|part| !part.trim().is_empty())
            }
            Self::Prune { retention, .. } => !retention.is_noop(),
            Self::Start
            | Self::Stop
            | Self::Restart
            | Self::Kill
            | Self::Sleep { .. }
            | Self::Backup { .. } => true,
        }
    }
}

pub fn normalize_cron(expression: &str) -> String {
    let expression = expression.trim();

    if expression.split_whitespace().count() == 5 {
        format!("0 {expression}")
    } else {
        expression.to_owned()
    }
}

pub fn parse_cron(expression: &str) -> Option<Schedule> {
    Schedule::from_str(&normalize_cron(expression)).ok()
}

pub fn next_run(expression: &str, timezone: &str) -> Option<DateTime<Utc>> {
    let schedule = parse_cron(expression)?;
    let timezone = Tz::from_str(timezone).ok()?;

    schedule
        .upcoming(timezone)
        .next()
        .map(|time| time.with_timezone(&Utc))
}
