use chrono::{TimeDelta, TimeZone as _, Utc};
use core::fmt::{Display, Formatter};
use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use redis::RedisError;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::{debug, error};

use crate::db::license::{License, TEAMSPEAK_LICENSE};
use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::templates::utils::{VERSION_REGEX, embed_script, github_release_tags, template_client};
use crate::templates::variable::{
    VariableBuilder, VariableContent, VariableDataBuilder, VariableGroupBuilder, VariablePayload,
};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const VOICE_PORT: u16 = 9987;
const FILETRANSFER_PORT: u16 = 30033;
const QUERY_SSH_PORT: u16 = 10022;
const QUERY_HTTP_PORT: u16 = 10080;
const VOICE_PORT_NAME: &str = "voice";
const FILETRANSFER_PORT_NAME: &str = "filetransfer";
const QUERY_SSH_PORT_NAME: &str = "query_ssh";
const QUERY_HTTP_PORT_NAME: &str = "query_http";
const REL: u32 = 2;
const TEAMSPEAK3_VERSIONS: &str = "https://www.teamspeak.com/versions/server.json";
const TEAMSPEAK6_REPOSITORY: &str = "teamspeak/teamspeak6-server";
const ENTRYPOINT_PATH: &str = "/usr/local/bin/teamspeak-entrypoint";

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) enum TeamSpeakSoftware {
    #[serde(rename = "teamspeak3")]
    TeamSpeak3,
    #[serde(rename = "teamspeak6")]
    TeamSpeak6,
}

impl TeamSpeakSoftware {
    const ALL: [Self; 2] = [Self::TeamSpeak3, Self::TeamSpeak6];

    const fn label(self) -> &'static str {
        match self {
            Self::TeamSpeak3 => "TeamSpeak 3",
            Self::TeamSpeak6 => "TeamSpeak 6",
        }
    }

    const fn id(self) -> &'static str {
        match self {
            Self::TeamSpeak3 => "teamspeak3",
            Self::TeamSpeak6 => "teamspeak6",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|software| software.label() == value)
    }

    fn dockerfile(self) -> String {
        let dockerfile = match self {
            Self::TeamSpeak3 => include_str!("teamspeak/teamspeak3.Dockerfile"),
            Self::TeamSpeak6 => include_str!("teamspeak/teamspeak6.Dockerfile"),
        };
        dockerfile.replace(
            "{ENTRYPOINT_SCRIPT}",
            &embed_script(ENTRYPOINT_PATH, include_str!("teamspeak/entrypoint.sh")),
        )
    }
}

impl Display for TeamSpeakSoftware {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(self.label())
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct TeamSpeakExtra {
    software: TeamSpeakSoftware,
    version: String,
}

impl TeamSpeakExtra {
    fn image(&self) -> ServerBuildImage {
        ServerBuildImage {
            dockerfile: self
                .software
                .dockerfile()
                .replace("{DEFAULT_VERSION}", &self.version),
            args: HashMap::new(),
            parents: Vec::new(),
            tag: None,
            default_tag: Some(format!("{}-{}-r{REL}", self.software.id(), self.version)),
            base: None,
        }
    }
}

#[derive(Readable, Writable)]
pub(crate) struct TeamSpeakVersionCache {
    teamspeak3: Vec<String>,
    teamspeak6: Vec<String>,
    updated: i64,
}

impl TeamSpeakVersionCache {
    const fn versions(&self, software: TeamSpeakSoftware) -> &Vec<String> {
        match software {
            TeamSpeakSoftware::TeamSpeak3 => &self.teamspeak3,
            TeamSpeakSoftware::TeamSpeak6 => &self.teamspeak6,
        }
    }
}

pub(crate) struct TeamSpeakTemplate;

impl Template for TeamSpeakTemplate {
    const ID: &'static str = "teamspeak";
    const REL: u32 = REL;
    type Extra = TeamSpeakExtra;
    type Cache = TeamSpeakVersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        Ok(ServerBuildPayload {
            image: extra.image(),
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
            environment: HashMap::new(),
            backup_exclude: HashSet::from(["logs/".to_owned()]),
            files_write: HashMap::new(),
            uid: None,
            gid: None,
            stop_command: None,
            stop_timeout: 30,
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let version = cache
            .teamspeak3
            .first()
            .ok_or(ThinTemplateError::Unavailable)?;

        Ok(TeamSpeakExtra {
            software: TeamSpeakSoftware::TeamSpeak3,
            version: version.clone(),
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([
            (
                VOICE_PORT_NAME.to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Udp,
                    internal_port: VOICE_PORT,
                    placeholder: "Voice".to_owned(),
                    remappable: false,
                    http: false,
                },
            ),
            (
                FILETRANSFER_PORT_NAME.to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Tcp,
                    internal_port: FILETRANSFER_PORT,
                    placeholder: "File Transfer".to_owned(),
                    remappable: false,
                    http: false,
                },
            ),
            (
                QUERY_SSH_PORT_NAME.to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Tcp,
                    internal_port: QUERY_SSH_PORT,
                    placeholder: "ServerQuery SSH".to_owned(),
                    remappable: true,
                    http: false,
                },
            ),
            (
                QUERY_HTTP_PORT_NAME.to_owned(),
                TemplatePortDefinition {
                    protocol: NetworkProtocol::Tcp,
                    internal_port: QUERY_HTTP_PORT,
                    placeholder: "WebQuery".to_owned(),
                    remappable: true,
                    http: false,
                },
            ),
        ]))
    }

    async fn extra_to_variables(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<VariablePayload, TemplateError> {
        let versions: HashMap<TeamSpeakSoftware, Vec<String>> = TeamSpeakSoftware::ALL
            .into_iter()
            .map(|software| {
                let mut versions = cache.versions(software).clone();
                if software == extra.software && !versions.contains(&extra.version) {
                    versions.push(extra.version.clone());
                }
                (software, versions)
            })
            .collect();

        Ok(VariableBuilder::default()
            .data(
                VariableDataBuilder::new(TeamSpeakSoftware::ALL.to_vec())
                    .layer_base_impl()
                    .layer::<2, _, _>(move |software| {
                        versions
                            .get(software)
                            .into_iter()
                            .flatten()
                            .map(|version| (version.clone(), VariableContent::Disabled {}))
                            .collect()
                    }),
            )
            .group(
                VariableGroupBuilder::new(Some("TeamSpeak version"))
                    .hierarchy_variable(
                        "software",
                        "Software",
                        Some(extra.software.to_string()),
                        0,
                        0,
                    )
                    .hierarchy_variable("version", "Version", Some(extra.version), 1, 0),
            )
            .into_payload())
    }

    async fn variables_to_extra_validated(
        &self,
        cache: &Self::Cache,
        old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> Result<Option<Self::Extra>, TemplateError> {
        let Some(software) = variables
            .get("software")
            .and_then(|value| TeamSpeakSoftware::from_label(value))
        else {
            debug!("Variables rejected: software missing or invalid");
            return Ok(None);
        };
        let Some(version) = variables.get("version") else {
            debug!("Variables rejected: version missing");
            return Ok(None);
        };

        let known = cache.versions(software).contains(version)
            || (old_extra.software == software && old_extra.version == *version);
        if !known || !VERSION_REGEX.is_match(version) {
            debug!("Variables rejected: invalid {software} version: {version:?}");
            return Ok(None);
        }

        Ok(Some(TeamSpeakExtra {
            software,
            version: version.clone(),
        }))
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
        self.primary_port_named(ports, VOICE_PORT_NAME).await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    fn licenses(&self) -> &'static [&'static License] {
        &[&TEAMSPEAK_LICENSE]
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        let client = template_client()?;

        Ok(TeamSpeakVersionCache {
            teamspeak3: resolve_teamspeak3(&client).await?,
            teamspeak6: github_release_tags(&client, TEAMSPEAK6_REPOSITORY, true).await?,
            updated: Utc::now().timestamp_millis(),
        })
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        Utc.timestamp_millis_opt(cache.updated)
            .single()
            .is_none_or(|updated| Utc::now() > updated + TimeDelta::days(1))
    }
}

#[derive(Deserialize)]
struct TeamSpeak3Versions {
    linux: TeamSpeak3Platform,
}

#[derive(Deserialize)]
struct TeamSpeak3Platform {
    x86_64: TeamSpeak3Release,
}

#[derive(Deserialize)]
struct TeamSpeak3Release {
    version: String,
}

async fn resolve_teamspeak3(client: &reqwest::Client) -> Result<Vec<String>, ()> {
    let versions: TeamSpeak3Versions = client
        .get(TEAMSPEAK3_VERSIONS)
        .send()
        .await
        .inspect_err(|err| error!("Unable to send teamspeak 3 versions request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get teamspeak 3 versions: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive teamspeak 3 versions: {err:?}"))
        .map_err(|_err| ())?;

    let version = versions.linux.x86_64.version;
    if !VERSION_REGEX.is_match(&version) {
        error!("Invalid teamspeak 3 version: {version:?}");
        return Err(());
    }

    Ok(vec![version])
}
