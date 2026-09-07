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

    /// Whether the step keeps more backups than `limit` allows, which a step
    /// without a retention policy always does: it never removes anything.
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

/// Normalises a cron expression to the six fields a node expects, so a
/// five-field expression is read as running at second zero.
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

#[cfg(test)]
mod tests {
    use super::{BackupRetention, ScheduleTask, normalize_cron, parse_cron};
    use daemon_common::service::schedule::ScheduleStep;

    fn retention(keep_last: u32) -> BackupRetention {
        BackupRetention {
            keep_last,
            ..BackupRetention::default()
        }
    }

    fn owned(parts: &[&str]) -> Vec<String> {
        parts.iter().copied().map(str::to_owned).collect()
    }

    #[test]
    fn lowers_a_minecraft_command_onto_the_rcon_invocation() {
        let step = ScheduleTask::MinecraftCommand {
            command: "  /say Restarting in 5 minutes ".to_owned(),
        }
        .compile();
        let expected = owned(&[
            "rcon",
            "-H",
            "::1",
            "-p",
            "25575",
            "-P",
            "_",
            "-m",
            "--",
            "say",
            "Restarting",
            "in",
            "5",
            "minutes",
        ]);

        assert!(
            matches!(&step, ScheduleStep::ContainerCommand { command } if command == &expected),
            "a minecraft command must compile to the rcon invocation, got {step:?}"
        );
    }

    #[test]
    fn passes_the_node_native_tasks_through_untouched() {
        assert!(
            matches!(ScheduleTask::Restart.compile(), ScheduleStep::Restart),
            "a restart must stay a restart"
        );
        assert!(
            matches!(
                ScheduleTask::Sleep { time: 30 }.compile(),
                ScheduleStep::Sleep { time: 30 }
            ),
            "a sleep must keep its duration"
        );

        let step = ScheduleTask::TerminalCommand {
            command: "stop".to_owned(),
        }
        .compile();
        assert!(
            matches!(&step, ScheduleStep::TerminalCommand { command } if command == "stop"),
            "a terminal command must stay a terminal command, got {step:?}"
        );
    }

    #[test]
    fn passes_a_backup_through_with_its_retention_policy() {
        let step = ScheduleTask::Backup {
            storage: Some("local".to_owned()),
            retention: Some(retention(3)),
        }
        .compile();

        assert!(
            matches!(
                &step,
                ScheduleStep::Backup {
                    storage: Some(storage),
                    retention: Some(retention)
                } if storage == "local" && retention.keep_last == 3
            ),
            "a backup must keep its storage and policy, got {step:?}"
        );
    }

    #[test]
    fn only_a_policy_that_fits_the_backup_limit_is_accepted() {
        let unbounded = ScheduleTask::Backup {
            storage: None,
            retention: None,
        };
        assert!(
            unbounded.exceeds_backup_limit(5),
            "a backup without a policy keeps growing past any limit"
        );

        let noop = ScheduleTask::Backup {
            storage: None,
            retention: Some(BackupRetention::default()),
        };
        assert!(
            noop.exceeds_backup_limit(5),
            "a policy whose counters are all zero keeps everything"
        );

        let fitting = ScheduleTask::Backup {
            storage: None,
            retention: Some(retention(5)),
        };
        assert!(
            !fitting.exceeds_backup_limit(5),
            "a policy that keeps exactly the limit fits"
        );
        assert!(
            fitting.exceeds_backup_limit(4),
            "a policy that keeps more than the limit does not fit"
        );

        assert!(
            !ScheduleTask::Restart.exceeds_backup_limit(1),
            "a step that creates no backup is never over the limit"
        );
    }

    #[test]
    fn recognises_which_backup_steps_delete() {
        assert!(
            !ScheduleTask::Backup {
                storage: None,
                retention: None
            }
            .removes_backups(),
            "a backup without a policy deletes nothing"
        );
        assert!(
            ScheduleTask::Backup {
                storage: None,
                retention: Some(retention(3))
            }
            .removes_backups(),
            "a backup with a policy deletes what the policy drops"
        );
        assert!(
            ScheduleTask::Prune {
                storage: None,
                retention: retention(3)
            }
            .removes_backups(),
            "a prune deletes"
        );
    }

    #[test]
    fn reads_a_five_field_expression_as_running_at_second_zero() {
        assert_eq!(
            normalize_cron("  30 4 * * *  "),
            "0 30 4 * * *",
            "a five field expression gains a zero seconds field"
        );
        assert_eq!(
            normalize_cron("0 30 4 * * *"),
            "0 30 4 * * *",
            "a six field expression is left alone"
        );

        assert!(parse_cron("30 4 * * *").is_some(), "five fields parse");
        assert!(parse_cron("0 30 4 * * *").is_some(), "six fields parse");
        assert!(
            parse_cron("not a cron expression").is_none(),
            "nonsense does not parse"
        );
    }

    #[test]
    fn rejects_tasks_whose_command_is_blank() {
        assert!(
            !ScheduleTask::MinecraftCommand {
                command: "   ".to_owned()
            }
            .is_complete(),
            "a blank minecraft command is incomplete"
        );
        assert!(
            !ScheduleTask::TerminalCommand {
                command: String::new()
            }
            .is_complete(),
            "an empty terminal command is incomplete"
        );
        assert!(
            !ScheduleTask::ContainerCommand {
                command: vec![" ".to_owned()]
            }
            .is_complete(),
            "a blank container command is incomplete"
        );
        assert!(
            ScheduleTask::Kill.is_complete(),
            "a kill needs no arguments"
        );
        assert!(
            !ScheduleTask::Prune {
                storage: None,
                retention: BackupRetention::default()
            }
            .is_complete(),
            "a prune that keeps everything would never do anything"
        );
    }
}
