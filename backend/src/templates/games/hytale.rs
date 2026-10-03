use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use indexmap::IndexSet;
use lazy_regex::lazy_regex;
use redis::RedisError;
use redis::aio::ConnectionManager;
use regex::Regex;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::debug;

use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::templates::utils::{RELATIVE_PATH_REGEX, is_relative_path};
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const SERVER_PORT: u16 = 5520;
const SERVER_PORT_NAME: &str = "hytale";
const BACKUP_FREQUENCY_MIN: u16 = 5;
const BACKUP_FREQUENCY_MAX: u16 = 1440;

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct HytaleExtra {
    auto_update: bool,
    patchline: HytalePatchline,
    auth_mode: HytaleAuthMode,
    assets_path: String,
    accept_early_plugins: bool,
    allow_op: bool,
    backups: HytaleBackups,
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum HytalePatchline {
    Default,
    PreRelease,
}

impl HytalePatchline {
    const fn downloader_value(&self) -> &'static str {
        match self {
            Self::Default => "",
            Self::PreRelease => "pre-release",
        }
    }

    const fn label(&self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::PreRelease => "Pre-Release",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        match value {
            "Default" => Some(Self::Default),
            "Pre-Release" => Some(Self::PreRelease),
            _ => None,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct HytaleBackups {
    enabled: bool,
    dir: String,
    frequency: u16,
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum HytaleAuthMode {
    Authenticated,
    Offline,
}

impl HytaleAuthMode {
    const fn server_value(&self) -> &'static str {
        match self {
            Self::Authenticated => "authenticated",
            Self::Offline => "offline",
        }
    }

    const fn label(&self) -> &'static str {
        match self {
            Self::Authenticated => "Authenticated",
            Self::Offline => "Offline",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        match value {
            "Authenticated" => Some(Self::Authenticated),
            "Offline" => Some(Self::Offline),
            _ => None,
        }
    }
}

#[derive(Readable, Writable)]
pub(crate) struct HytaleCache;

pub(crate) struct HytaleTemplate;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static POSITIVE_INTEGER_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[1-9][0-9]*$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static OPTIONAL_RELATIVE_PATH_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"^([A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*)?$");

fn flag(value: bool) -> String {
    if value { "1" } else { "0" }.to_owned()
}

impl Template for HytaleTemplate {
    const ID: &'static str = "hytale";
    type Extra = HytaleExtra;
    type Cache = HytaleCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        Ok(ServerBuildPayload {
            image: ServerBuildImage {
                dockerfile: include_str!("hytale.Dockerfile").to_owned(),
                default_tag: Some("hytale-r3".to_owned()),
                tag: None,
                args: HashMap::new(),
                parents: Vec::new(),
                base: None,
            },
            backup_exclude: HashSet::from([
                "Server/".to_owned(),
                "logs/".to_owned(),
                "game.zip".to_owned(),
                "Assets.zip".to_owned(),
                "hytale-downloader".to_owned(),
                ".hytale-downloader-credentials.json".to_owned(),
                extra.assets_path.clone(),
                format!("{}/", extra.backups.dir),
            ]),
            files_write: HashMap::new(),
            cap_add: Vec::new(),
            cap_drop: vec![
                "MKNOD".to_owned(),
                "FSETID".to_owned(),
                "FOWNER".to_owned(),
                "SETPCAP".to_owned(),
                "SETFCAP".to_owned(),
                "NET_RAW".to_owned(),
                "SYS_CHROOT".to_owned(),
                "AUDIT_WRITE".to_owned(),
                "DAC_OVERRIDE".to_owned(),
                "NET_BIND_SERVICE".to_owned(),
            ],
            environment: HashMap::from([
                ("AUTO_UPDATE".to_owned(), flag(extra.auto_update)),
                (
                    "PATCHLINE".to_owned(),
                    extra.patchline.downloader_value().to_owned(),
                ),
                (
                    "AUTH_MODE".to_owned(),
                    extra.auth_mode.server_value().to_owned(),
                ),
                ("ASSETS_PATH".to_owned(), extra.assets_path),
                (
                    "ACCEPT_EARLY_PLUGINS".to_owned(),
                    flag(extra.accept_early_plugins),
                ),
                ("ALLOW_OP".to_owned(), flag(extra.allow_op)),
                ("ENABLE_BACKUPS".to_owned(), flag(extra.backups.enabled)),
                ("BACKUP_DIR".to_owned(), extra.backups.dir),
                (
                    "BACKUP_FREQUENCY".to_owned(),
                    extra.backups.frequency.to_string(),
                ),
            ]),
            uid: None,
            gid: None,
            stop_command: Some("stop".to_owned()),
            stop_timeout: 120,
        })
    }

    async fn default_extra(&self, _cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        Ok(HytaleExtra {
            auto_update: true,
            patchline: HytalePatchline::Default,
            auth_mode: HytaleAuthMode::Authenticated,
            assets_path: String::new(),
            accept_early_plugins: false,
            allow_op: false,
            backups: HytaleBackups {
                enabled: false,
                dir: "backups".to_owned(),
                frequency: 60,
            },
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([(
            SERVER_PORT_NAME.to_owned(),
            TemplatePortDefinition {
                protocol: NetworkProtocol::Udp,
                internal_port: SERVER_PORT,
                placeholder: "Hytale".to_owned(),
                remappable: true,
                http: false,
            },
        )]))
    }

    async fn extra_to_variables(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<VariablePayload, TemplateError> {
        Ok(VariableBuilder::default()
            .group(
                VariableGroupBuilder::new(Some("Hytale"))
                    .static_variable(
                        "auth_mode",
                        "Authentication Mode",
                        Some(extra.auth_mode.label()),
                        IndexSet::from(["Authenticated".to_owned(), "Offline".to_owned()]),
                    )
                    .regex_variable(
                        "assets_path",
                        "Assets File Path",
                        Some(extra.assets_path),
                        OPTIONAL_RELATIVE_PATH_REGEX.as_str(),
                        "Leave empty to detect automatically",
                        false,
                    ),
            )
            .group(
                VariableGroupBuilder::new(Some("Updates"))
                    .checkbox_variable(
                        "auto_update",
                        "Automatic Updates",
                        Some(extra.auto_update),
                        "Check for updates on startup".to_owned(),
                    )
                    .static_variable(
                        "patchline",
                        "Patchline",
                        Some(extra.patchline.label()),
                        IndexSet::from(["Default".to_owned(), "Pre-Release".to_owned()]),
                    ),
            )
            .group(
                VariableGroupBuilder::new(Some("Gameplay"))
                    .checkbox_variable(
                        "allow_op",
                        "Allow Operator Commands",
                        Some(extra.allow_op),
                        "Allow operator commands on the server".to_owned(),
                    )
                    .checkbox_variable(
                        "accept_early_plugins",
                        "Accept Early Plugins",
                        Some(extra.accept_early_plugins),
                        "Load plugins built against unsupported early APIs".to_owned(),
                    ),
            )
            .group(
                VariableGroupBuilder::new(Some("In-Game Backups"))
                    .checkbox_variable(
                        "enable_backups",
                        "Enable In-Game Backups",
                        Some(extra.backups.enabled),
                        "Let the server write its own backups, additionally to the panel"
                            .to_owned(),
                    )
                    .regex_variable(
                        "backup_dir",
                        "Backup Directory",
                        Some(extra.backups.dir),
                        RELATIVE_PATH_REGEX.as_str(),
                        "backups",
                        false,
                    )
                    .regex_variable(
                        "backup_frequency",
                        "Backup Frequency (minutes)",
                        Some(extra.backups.frequency.to_string()),
                        POSITIVE_INTEGER_REGEX.as_str(),
                        "60",
                        false,
                    ),
            )
            .into_payload())
    }

    async fn variables_to_extra_validated(
        &self,
        _cache: &Self::Cache,
        _old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> Result<Option<Self::Extra>, TemplateError> {
        let Some(auth_mode_raw) = variables.get("auth_mode") else {
            debug!("Variables rejected: auth_mode missing");
            return Ok(None);
        };
        let Some(auth_mode) = HytaleAuthMode::from_label(auth_mode_raw) else {
            debug!("Variables rejected: auth_mode invalid");
            return Ok(None);
        };

        let Some(patchline_raw) = variables.get("patchline") else {
            debug!("Variables rejected: patchline missing");
            return Ok(None);
        };
        let Some(patchline) = HytalePatchline::from_label(patchline_raw) else {
            debug!("Variables rejected: patchline invalid");
            return Ok(None);
        };

        let Some(extra) = (|| {
            Some(HytaleExtra {
                auto_update: variables.get("auto_update")?.parse::<bool>().ok()?,
                patchline,
                auth_mode,
                assets_path: variables.get("assets_path")?.clone(),
                accept_early_plugins: variables
                    .get("accept_early_plugins")?
                    .parse::<bool>()
                    .ok()?,
                allow_op: variables.get("allow_op")?.parse::<bool>().ok()?,
                backups: HytaleBackups {
                    enabled: variables.get("enable_backups")?.parse::<bool>().ok()?,
                    dir: variables.get("backup_dir")?.clone(),
                    frequency: variables.get("backup_frequency")?.parse::<u16>().ok()?,
                },
            })
        })() else {
            debug!("Variables rejected: invalid Hytale numeric or boolean value");
            return Ok(None);
        };

        if !extra.assets_path.is_empty() && !is_relative_path(&extra.assets_path) {
            debug!("Variables rejected: assets_path is not a relative path");
            return Ok(None);
        }

        if !is_relative_path(&extra.backups.dir) {
            debug!("Variables rejected: backup_dir is not a relative path");
            return Ok(None);
        }

        if !(BACKUP_FREQUENCY_MIN..=BACKUP_FREQUENCY_MAX).contains(&extra.backups.frequency) {
            debug!("Variables rejected: backup_frequency out of range");
            return Ok(None);
        }

        Ok(Some(extra))
    }

    async fn enabled_features(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        Ok(HashSet::new())
    }

    async fn primary_port(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
        ports: &HashMap<u32, ServerPort>,
    ) -> Option<(u32, ServerPort, u16)> {
        self.primary_port_named(ports, SERVER_PORT_NAME).await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        Ok(HytaleCache)
    }

    fn cache_update_needed(_cache: &Self::Cache) -> bool {
        false
    }
}
