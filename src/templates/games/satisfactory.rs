use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload, ServerFileWrite};
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
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const SATISFACTORY_APP_ID: u32 = 1_690_800;
const SERVER_PORT: u16 = 7777;
const RELIABLE_PORT: u16 = 8888;

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct SatisfactoryExtra {
    auto_update: bool,
    validate: bool,
    num_autosaves: u16,
    max_players: u16,
    init_connect_timeout: u16,
    connect_timeout: u16,
    branch: SatisfactoryBranch,
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SatisfactoryBranch {
    Default,
    Public,
    Experimental,
}

impl SatisfactoryBranch {
    const fn steamcmd_value(&self) -> &'static str {
        match self {
            Self::Default => "",
            Self::Public => "public",
            Self::Experimental => "experimental",
        }
    }

    const fn label(&self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::Public => "Public",
            Self::Experimental => "Experimental",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        match value {
            "Default" => Some(Self::Default),
            "Public" => Some(Self::Public),
            "Experimental" => Some(Self::Experimental),
            _ => None,
        }
    }
}

#[derive(Readable, Writable)]
pub(crate) struct SatisfactoryCache;

pub(crate) struct SatisfactoryTemplate;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static POSITIVE_INTEGER_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[1-9][0-9]*$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static NON_NEGATIVE_INTEGER_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[0-9]+$");

impl Template for SatisfactoryTemplate {
    const ID: &'static str = "satisfactory";
    type Extra = SatisfactoryExtra;
    type Cache = SatisfactoryCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        Ok(ServerBuildPayload {
            image: ServerBuildImage {
                dockerfile: include_str!("satisfactory.Dockerfile").to_owned(),
                default_tag: Some("satisfactory-steamcmd-r1".to_owned()),
                tag: None,
                args: HashMap::new(),
                parents: Vec::new(),
                base: None,
            },
            backup_exclude: HashSet::from([
                "steamcmd/".to_owned(),
                ".steam/".to_owned(),
                "Engine/Binaries/ThirdParty/Steamworks/".to_owned(),
            ]),
            files_write: HashMap::from([
                (
                    "FactoryGame/Saved/Config/LinuxServer/Game.ini".to_owned(),
                    ServerFileWrite::Ini {
                        content: HashMap::from([(
                            "/Script/Engine.GameSession".to_owned(),
                            HashMap::from([("MaxPlayers".to_owned(), extra.max_players.to_string())]),
                        )]),
                    },
                ),
                (
                    "FactoryGame/Saved/Config/LinuxServer/Engine.ini".to_owned(),
                    ServerFileWrite::Ini {
                        content: HashMap::from([
                            (
                                "/Script/FactoryGame.FGSaveSession".to_owned(),
                                HashMap::from([(
                                    "mNumRotatingAutosaves".to_owned(),
                                    extra.num_autosaves.to_string(),
                                )]),
                            ),
                            (
                                "/Script/OnlineSubsystemUtils.IpNetDriver".to_owned(),
                                HashMap::from([
                                    (
                                        "InitialConnectTimeout".to_owned(),
                                        extra.init_connect_timeout.to_string(),
                                    ),
                                    (
                                        "ConnectionTimeout".to_owned(),
                                        extra.connect_timeout.to_string(),
                                    ),
                                ]),
                            ),
                        ]),
                    },
                ),
            ]),
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
                ("AUTO_UPDATE".to_owned(), bool_env(extra.auto_update)),
                ("VALIDATE".to_owned(), bool_env(extra.validate)),
                (
                    "SRCDS_BETAID".to_owned(),
                    extra.branch.steamcmd_value().to_owned(),
                ),
                ("SRCDS_APPID".to_owned(), SATISFACTORY_APP_ID.to_string()),
            ]),
            uid: None,
            gid: None,
            stop_command: None,
            stop_timeout: 120,
        })
    }

    async fn default_extra(&self, _cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        Ok(SatisfactoryExtra {
            auto_update: true,
            validate: false,
            num_autosaves: 3,
            max_players: 4,
            init_connect_timeout: 30,
            connect_timeout: 20,
            branch: SatisfactoryBranch::Default,
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([
            (
                "satisfactory_tcp".to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Tcp,
                    internal_port: SERVER_PORT,
                    placeholder: "Satisfactory TCP".to_owned(),
                },
            ),
            (
                "satisfactory_udp".to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Udp,
                    internal_port: SERVER_PORT,
                    placeholder: "Satisfactory UDP".to_owned(),
                },
            ),
            (
                "reliable_messaging".to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Tcp,
                    internal_port: RELIABLE_PORT,
                    placeholder: "Reliable Messaging".to_owned(),
                },
            ),
        ]))
    }

    async fn extra_to_variables(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<VariablePayload, TemplateError> {
        Ok(VariableBuilder::default()
            .group(
                VariableGroupBuilder::new(Some("Satisfactory")).static_variable(
                    "branch",
                    "Branch",
                    Some(extra.branch.label()),
                    IndexSet::from([
                        "Default".to_owned(),
                        "Public".to_owned(),
                        "Experimental".to_owned(),
                    ]),
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
            .group(
                VariableGroupBuilder::new(Some("Gameplay"))
                    .regex_variable(
                        "num_autosaves",
                        "Number of Rotating Autosaves",
                        Some(extra.num_autosaves.to_string()),
                        NON_NEGATIVE_INTEGER_REGEX.as_str(),
                        "3",
                        false,
                    )
                    .regex_variable(
                        "max_players",
                        "Max Players",
                        Some(extra.max_players.to_string()),
                        POSITIVE_INTEGER_REGEX.as_str(),
                        "4",
                        false,
                    ),
            )
            .group(
                VariableGroupBuilder::new(Some("Advanced"))
                    .regex_variable(
                        "init_connect_timeout",
                        "Client Initial Connection Timeout",
                        Some(extra.init_connect_timeout.to_string()),
                        POSITIVE_INTEGER_REGEX.as_str(),
                        "30",
                        false,
                    )
                    .regex_variable(
                        "connect_timeout",
                        "Client Established Connection Timeout",
                        Some(extra.connect_timeout.to_string()),
                        POSITIVE_INTEGER_REGEX.as_str(),
                        "20",
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
        let Some(branch_raw) = variables.get("branch") else {
            debug!("Variables rejected: branch missing");
            return Ok(None);
        };
        let Some(branch) = SatisfactoryBranch::from_label(branch_raw) else {
            debug!("Variables rejected: branch invalid");
            return Ok(None);
        };

        let Some(extra) = (|| {
            Some(SatisfactoryExtra {
                auto_update: parse_bool(variables.get("auto_update")?)?,
                validate: parse_bool(variables.get("validate")?)?,
                num_autosaves: parse_u16(variables.get("num_autosaves")?)?,
                max_players: parse_positive_u16(variables.get("max_players")?)?,
                init_connect_timeout: parse_positive_u16(variables.get("init_connect_timeout")?)?,
                connect_timeout: parse_positive_u16(variables.get("connect_timeout")?)?,
                branch,
            })
        })() else {
            debug!("Variables rejected: invalid Satisfactory numeric or boolean value");
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
        self.primary_port0(ports, SERVER_PORT, NetworkProtocol::Tcp)
            .await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        Ok(SatisfactoryCache)
    }

    fn cache_update_needed(_cache: &Self::Cache) -> bool {
        false
    }
}

fn bool_env(value: bool) -> String {
    if value { "1" } else { "0" }.to_owned()
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" | "1" => Some(true),
        "false" | "0" | "" => Some(false),
        _ => None,
    }
}

fn parse_u16(value: &str) -> Option<u16> {
    NON_NEGATIVE_INTEGER_REGEX
        .is_match(value)
        .then(|| value.parse::<u16>().ok())
        .flatten()
}

fn parse_positive_u16(value: &str) -> Option<u16> {
    POSITIVE_INTEGER_REGEX
        .is_match(value)
        .then(|| value.parse::<u16>().ok().filter(|value| *value > 0))
        .flatten()
}
