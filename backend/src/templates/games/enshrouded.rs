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
use crate::templates::utils::embed_script;
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const ENSHROUDED_APP_ID: u32 = 2_278_520;
const QUERY_PORT: u16 = 15637;
const QUERY_PORT_NAME: &str = "enshrouded";
const MAX_SLOTS: u8 = 16;
const ENTRYPOINT_PATH: &str = "/usr/local/bin/enshrouded-entrypoint";
const A2S_PATH: &str = "/usr/local/bin/steam-a2s";
const REL: u32 = 1;

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct EnshroudedExtra {
    auto_update: bool,
    validate: bool,
    server_name: String,
    max_players: u8,
    preset: EnshroudedPreset,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum EnshroudedPreset {
    Default,
    Relaxed,
    Hard,
    Survival,
    Custom,
}

impl EnshroudedPreset {
    const ALL: [Self; 5] = [
        Self::Default,
        Self::Relaxed,
        Self::Hard,
        Self::Survival,
        Self::Custom,
    ];

    const fn label(self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::Relaxed => "Relaxed",
            Self::Hard => "Hard",
            Self::Survival => "Survival",
            Self::Custom => "Custom",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|preset| preset.label() == value)
    }
}

#[derive(Readable, Writable)]
pub(crate) struct EnshroudedCache;

pub(crate) struct EnshroudedTemplate;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static SERVER_NAME_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^\S.{0,63}$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static MAX_PLAYERS_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^([1-9]|1[0-6])$");

fn dockerfile() -> String {
    include_str!("enshrouded/enshrouded.Dockerfile")
        .replace(
            "{ENTRYPOINT_SCRIPT}",
            &embed_script(ENTRYPOINT_PATH, include_str!("enshrouded/entrypoint.sh")),
        )
        .replace(
            "{A2S_SCRIPT}",
            &embed_script(A2S_PATH, include_str!("steam_a2s.py")),
        )
}

impl Template for EnshroudedTemplate {
    const ID: &'static str = "enshrouded";
    const REL: u32 = REL;
    type Extra = EnshroudedExtra;
    type Cache = EnshroudedCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        Ok(ServerBuildPayload {
            image: ServerBuildImage {
                dockerfile: dockerfile(),
                default_tag: Some(format!("enshrouded-wine-r{REL}")),
                tag: None,
                args: HashMap::new(),
                parents: Vec::new(),
                base: None,
            },
            backup_exclude: HashSet::from([
                "steamcmd/".to_owned(),
                "steamapps/".to_owned(),
                "Steam/".to_owned(),
                ".steam/".to_owned(),
                ".wine/".to_owned(),
                "logs/".to_owned(),
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
                (
                    "AUTO_UPDATE".to_owned(),
                    if extra.auto_update { "1" } else { "0" }.to_owned(),
                ),
                (
                    "VALIDATE".to_owned(),
                    if extra.validate { "1" } else { "0" }.to_owned(),
                ),
                ("SRCDS_APPID".to_owned(), ENSHROUDED_APP_ID.to_string()),
                ("SERVER_NAME".to_owned(), extra.server_name),
                ("MAX_PLAYERS".to_owned(), extra.max_players.to_string()),
                (
                    "DIFFICULTY_PRESET".to_owned(),
                    extra.preset.label().to_owned(),
                ),
            ]),
            uid: None,
            gid: None,
            stop_command: None,
            stop_timeout: 120,
        })
    }

    async fn default_extra(&self, _cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        Ok(EnshroudedExtra {
            auto_update: true,
            validate: false,
            server_name: "Enshrouded Server".to_owned(),
            max_players: MAX_SLOTS,
            preset: EnshroudedPreset::Default,
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([(
            QUERY_PORT_NAME.to_owned(),
            TemplatePortDefinition {
                protocol: NetworkProtocol::Udp,
                internal_port: QUERY_PORT,
                placeholder: "Enshrouded".to_owned(),
                remappable: false,
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
                VariableGroupBuilder::new(Some("Enshrouded"))
                    .regex_variable(
                        "server_name",
                        "Server Name",
                        Some(extra.server_name),
                        SERVER_NAME_REGEX.as_str(),
                        "Enshrouded Server",
                        false,
                    )
                    .regex_variable(
                        "max_players",
                        "Max Players",
                        Some(extra.max_players.to_string()),
                        MAX_PLAYERS_REGEX.as_str(),
                        "16",
                        false,
                    )
                    .static_variable(
                        "preset",
                        "Difficulty Preset",
                        Some(extra.preset.label()),
                        EnshroudedPreset::ALL
                            .into_iter()
                            .map(EnshroudedPreset::label)
                            .collect::<IndexSet<_>>(),
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
                    .checkbox_variable(
                        "validate",
                        "Validate Server Files",
                        Some(extra.validate),
                        "Validate files during SteamCMD updates".to_owned(),
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
        let Some(preset) = variables
            .get("preset")
            .and_then(|value| EnshroudedPreset::from_label(value))
        else {
            debug!("Variables rejected: preset missing or invalid");
            return Ok(None);
        };

        let Some(server_name) = variables
            .get("server_name")
            .filter(|value| SERVER_NAME_REGEX.is_match(value))
        else {
            debug!("Variables rejected: server name missing or invalid");
            return Ok(None);
        };

        let Some(extra) = (|| {
            Some(EnshroudedExtra {
                auto_update: variables.get("auto_update")?.parse::<bool>().ok()?,
                validate: variables.get("validate")?.parse::<bool>().ok()?,
                server_name: server_name.clone(),
                max_players: variables
                    .get("max_players")?
                    .parse::<u8>()
                    .ok()
                    .filter(|value| (1..=MAX_SLOTS).contains(value))?,
                preset,
            })
        })() else {
            debug!("Variables rejected: invalid Enshrouded numeric or boolean value");
            return Ok(None);
        };

        Ok(Some(extra))
    }

    async fn enabled_features(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        Ok(HashSet::from(["steamcmd"]))
    }

    async fn primary_port(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
        ports: &HashMap<u32, ServerPort>,
    ) -> Option<(u32, ServerPort, u16)> {
        self.primary_port_named(ports, QUERY_PORT_NAME).await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        Ok(EnshroudedCache)
    }

    fn cache_update_needed(_cache: &Self::Cache) -> bool {
        false
    }
}
