use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
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

const ARMA_REFORGER_APP_ID: u32 = 1_874_900;
const GAME_PORT: u16 = 2001;
const A2S_PORT: u16 = 17777;
const GAME_PORT_NAME: &str = "arma_reforger";
const A2S_PORT_NAME: &str = "a2s";
const MAX_PLAYERS: u16 = 256;
const DEFAULT_SCENARIO: &str = "{ECC61978EDCC2B5A}Missions/23_Campaign.conf";
const ENTRYPOINT_PATH: &str = "/usr/local/bin/arma-reforger-entrypoint";
const A2S_PATH: &str = "/usr/local/bin/steam-a2s";
const REL: u32 = 1;

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "mirrors the server's independent config flags"
)]
pub(crate) struct ArmaReforgerExtra {
    auto_update: bool,
    validate: bool,
    server_name: String,
    server_password: String,
    admin_password: String,
    scenario_id: String,
    max_players: u16,
    visible: bool,
    disable_third_person: bool,
    battleye: bool,
    max_fps: u16,
    log_interval: u16,
}

#[derive(Readable, Writable)]
pub(crate) struct ArmaReforgerCache;

pub(crate) struct ArmaReforgerTemplate;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static SERVER_NAME_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^\S.{0,254}$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static PASSWORD_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^\S{0,32}$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static SCENARIO_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^\{[0-9A-Fa-f]{16}\}\S+$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static POSITIVE_INTEGER_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[1-9][0-9]*$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static NON_NEGATIVE_INTEGER_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[0-9]+$");

fn dockerfile() -> String {
    include_str!("arma_reforger/arma_reforger.Dockerfile")
        .replace(
            "{ENTRYPOINT_SCRIPT}",
            &embed_script(ENTRYPOINT_PATH, include_str!("arma_reforger/entrypoint.sh")),
        )
        .replace(
            "{A2S_SCRIPT}",
            &embed_script(A2S_PATH, include_str!("steam_a2s.py")),
        )
}

fn matching<'a>(
    variables: &'a HashMap<String, String>,
    key: &str,
    regex: &Regex,
) -> Option<&'a String> {
    variables.get(key).filter(|value| regex.is_match(value))
}

impl Template for ArmaReforgerTemplate {
    const ID: &'static str = "arma_reforger";
    const REL: u32 = REL;
    type Extra = ArmaReforgerExtra;
    type Cache = ArmaReforgerCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        Ok(ServerBuildPayload {
            image: ServerBuildImage {
                dockerfile: dockerfile(),
                default_tag: Some(format!("arma-reforger-steamcmd-r{REL}")),
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
                "addons/".to_owned(),
                "tmp/".to_owned(),
                "profile/logs/".to_owned(),
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
                ("SRCDS_APPID".to_owned(), ARMA_REFORGER_APP_ID.to_string()),
                ("SERVER_NAME".to_owned(), extra.server_name),
                ("SERVER_PASSWORD".to_owned(), extra.server_password),
                ("ADMIN_PASSWORD".to_owned(), extra.admin_password),
                ("SCENARIO_ID".to_owned(), extra.scenario_id),
                ("MAX_PLAYERS".to_owned(), extra.max_players.to_string()),
                ("VISIBLE".to_owned(), extra.visible.to_string()),
                (
                    "DISABLE_THIRD_PERSON".to_owned(),
                    extra.disable_third_person.to_string(),
                ),
                ("BATTLEYE".to_owned(), extra.battleye.to_string()),
                ("MAX_FPS".to_owned(), extra.max_fps.to_string()),
                ("LOG_INTERVAL".to_owned(), extra.log_interval.to_string()),
            ]),
            uid: None,
            gid: None,
            stop_command: None,
            stop_timeout: 120,
        })
    }

    async fn default_extra(&self, _cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        Ok(ArmaReforgerExtra {
            auto_update: true,
            validate: false,
            server_name: "Arma Reforger Server".to_owned(),
            server_password: String::new(),
            admin_password: String::new(),
            scenario_id: DEFAULT_SCENARIO.to_owned(),
            max_players: 32,
            visible: true,
            disable_third_person: false,
            battleye: true,
            max_fps: 120,
            log_interval: 0,
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([
            (
                GAME_PORT_NAME.to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Udp,
                    internal_port: GAME_PORT,
                    placeholder: "Arma Reforger".to_owned(),
                    remappable: false,
                    http: false,
                },
            ),
            (
                A2S_PORT_NAME.to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Udp,
                    internal_port: A2S_PORT,
                    placeholder: "Steam Query (A2S)".to_owned(),
                    remappable: false,
                    http: false,
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
                VariableGroupBuilder::new(Some("Arma Reforger"))
                    .regex_variable(
                        "server_name",
                        "Server Name",
                        Some(extra.server_name),
                        SERVER_NAME_REGEX.as_str(),
                        "Arma Reforger Server",
                        false,
                    )
                    .regex_variable(
                        "server_password",
                        "Server Password",
                        Some(extra.server_password),
                        PASSWORD_REGEX.as_str(),
                        "",
                        true,
                    )
                    .regex_variable(
                        "admin_password",
                        "Admin Password",
                        Some(extra.admin_password),
                        PASSWORD_REGEX.as_str(),
                        "",
                        true,
                    )
                    .regex_variable(
                        "scenario_id",
                        "Scenario ID",
                        Some(extra.scenario_id),
                        SCENARIO_REGEX.as_str(),
                        DEFAULT_SCENARIO,
                        false,
                    )
                    .checkbox_variable(
                        "visible",
                        "Visible in Server Browser",
                        Some(extra.visible),
                        "List the server in the server browser".to_owned(),
                    ),
            )
            .group(
                VariableGroupBuilder::new(Some("Gameplay"))
                    .regex_variable(
                        "max_players",
                        "Max Players",
                        Some(extra.max_players.to_string()),
                        POSITIVE_INTEGER_REGEX.as_str(),
                        "32",
                        false,
                    )
                    .checkbox_variable(
                        "disable_third_person",
                        "Disable Third Person",
                        Some(extra.disable_third_person),
                        "Force first person view".to_owned(),
                    )
                    .checkbox_variable(
                        "battleye",
                        "BattlEye",
                        Some(extra.battleye),
                        "Require the BattlEye anti-cheat".to_owned(),
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
                VariableGroupBuilder::new(Some("Advanced"))
                    .regex_variable(
                        "max_fps",
                        "Max FPS (0 for no limit)",
                        Some(extra.max_fps.to_string()),
                        NON_NEGATIVE_INTEGER_REGEX.as_str(),
                        "120",
                        false,
                    )
                    .regex_variable(
                        "log_interval",
                        "Stats Log Interval in Seconds (0 to disable)",
                        Some(extra.log_interval.to_string()),
                        NON_NEGATIVE_INTEGER_REGEX.as_str(),
                        "0",
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
        let Some(extra) = (|| {
            Some(ArmaReforgerExtra {
                auto_update: variables.get("auto_update")?.parse::<bool>().ok()?,
                validate: variables.get("validate")?.parse::<bool>().ok()?,
                server_name: matching(&variables, "server_name", &SERVER_NAME_REGEX)?.clone(),
                server_password: matching(&variables, "server_password", &PASSWORD_REGEX)?.clone(),
                admin_password: matching(&variables, "admin_password", &PASSWORD_REGEX)?.clone(),
                scenario_id: matching(&variables, "scenario_id", &SCENARIO_REGEX)?.clone(),
                max_players: variables
                    .get("max_players")?
                    .parse::<u16>()
                    .ok()
                    .filter(|value| (1..=MAX_PLAYERS).contains(value))?,
                visible: variables.get("visible")?.parse::<bool>().ok()?,
                disable_third_person: variables
                    .get("disable_third_person")?
                    .parse::<bool>()
                    .ok()?,
                battleye: variables.get("battleye")?.parse::<bool>().ok()?,
                max_fps: variables.get("max_fps")?.parse::<u16>().ok()?,
                log_interval: variables.get("log_interval")?.parse::<u16>().ok()?,
            })
        })() else {
            debug!("Variables rejected: invalid Arma Reforger value");
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
        self.primary_port_named(ports, GAME_PORT_NAME).await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        Ok(ArmaReforgerCache)
    }

    fn cache_update_needed(_cache: &Self::Cache) -> bool {
        false
    }
}
