use chrono::{TimeDelta, TimeZone as _, Utc};
use core::fmt::{Display, Formatter};
use daemon_common::service::server::{
    Patch, PatchEntry, PatchSet, ServerBuildImage, ServerBuildPayload, ServerFileWrite,
};
use lazy_regex::lazy_regex;
use redis::RedisError;
use redis::aio::ConnectionManager;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::{debug, error};

use crate::db::license::{License, MINECRAFT_EULA};
use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::templates::utils::embed_script;
use crate::templates::variable::{
    VariableBuilder, VariableContent, VariableDataBuilder, VariableGroupBuilder, VariablePayload,
};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const SERVER_PORT: u16 = 19132;
const SERVER_PORT_V6: u16 = 19133;
const SERVER_PORT_NAME: &str = "bedrock";
const REL: usize = 1;
const MAX_RELEASES: usize = 20;
const USER_AGENT: &str = "novium-backend";
const BEDROCK_DOWNLOAD_LINKS: &str =
    "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links";
const POCKETMINE_RELEASES: &str = "https://api.github.com/repos/pmmp/PocketMine-MP/releases";
const POWERNUKKITX_RELEASES: &str =
    "https://api.github.com/repos/PowerNukkitX/PowerNukkitX/releases";

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static VERSION_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[0-9A-Za-z][0-9A-Za-z._-]*$");

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
static BEDROCK_URL_VERSION_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"/bedrock-server-([0-9.]+)\.zip$");

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BedrockSoftware {
    Vanilla,
    #[serde(rename = "pocketmine")]
    PocketMine,
    #[serde(rename = "powernukkitx")]
    PowerNukkitX,
}

impl BedrockSoftware {
    const ALL: [Self; 3] = [Self::Vanilla, Self::PocketMine, Self::PowerNukkitX];

    const fn label(self) -> &'static str {
        match self {
            Self::Vanilla => "Vanilla",
            Self::PocketMine => "PocketMine-MP",
            Self::PowerNukkitX => "PowerNukkitX",
        }
    }

    const fn id(self) -> &'static str {
        match self {
            Self::Vanilla => "vanilla",
            Self::PocketMine => "pocketmine",
            Self::PowerNukkitX => "powernukkitx",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|software| software.label() == value)
    }

    fn dockerfile(self) -> String {
        match self {
            Self::Vanilla => include_str!("minecraft_bedrock/vanilla.Dockerfile").replace(
                "{ENTRYPOINT_SCRIPT}",
                &embed_script(
                    "/usr/local/bin/bedrock-entrypoint",
                    include_str!("minecraft_bedrock/entrypoint.sh"),
                ),
            ),
            Self::PocketMine => include_str!("minecraft_bedrock/pocketmine.Dockerfile").to_owned(),
            Self::PowerNukkitX => {
                include_str!("minecraft_bedrock/powernukkitx.Dockerfile").to_owned()
            }
        }
    }

    fn files_write(self) -> HashMap<String, ServerFileWrite> {
        match self {
            Self::Vanilla => HashMap::from([(
                "server.properties".to_owned(),
                ServerFileWrite::JavaProperties {
                    content: HashMap::from([
                        ("server-port".to_owned(), SERVER_PORT.to_string()),
                        ("server-portv6".to_owned(), SERVER_PORT_V6.to_string()),
                    ]),
                },
            )]),
            Self::PocketMine => HashMap::from([(
                "server.properties".to_owned(),
                ServerFileWrite::JavaProperties {
                    content: HashMap::from([("server-port".to_owned(), SERVER_PORT.to_string())]),
                },
            )]),
            Self::PowerNukkitX => HashMap::from([(
                "pnx.yml".to_owned(),
                ServerFileWrite::Yaml {
                    set: vec![PatchSet {
                        condition: Patch(vec![]),
                        patch: PatchEntry::Merge {
                            patch: json!({ "settings": { "port": SERVER_PORT } }),
                        },
                    }],
                },
            )]),
        }
    }

    fn backup_exclude(self) -> HashSet<String> {
        match self {
            Self::Vanilla | Self::PocketMine => HashSet::new(),
            Self::PowerNukkitX => HashSet::from(["logs/".to_owned()]),
        }
    }
}

impl Display for BedrockSoftware {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        formatter.write_str(self.label())
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct MinecraftBedrockExtra {
    software: BedrockSoftware,
    version: String,
}

impl MinecraftBedrockExtra {
    fn image(&self) -> ServerBuildImage {
        ServerBuildImage {
            dockerfile: self.software.dockerfile(),
            args: HashMap::from([("VERSION".to_owned(), self.version.clone())]),
            parents: Vec::new(),
            tag: None,
            default_tag: Some(format!(
                "minecraft_bedrock_{}-{}-r{REL}",
                self.software.id(),
                self.version
            )),
            base: None,
        }
    }
}

#[derive(Readable, Writable)]
pub(crate) struct BedrockVersionCache {
    vanilla: Vec<String>,
    pocketmine: Vec<String>,
    powernukkitx: Vec<String>,
    updated: i64,
}

impl BedrockVersionCache {
    const fn versions(&self, software: BedrockSoftware) -> &Vec<String> {
        match software {
            BedrockSoftware::Vanilla => &self.vanilla,
            BedrockSoftware::PocketMine => &self.pocketmine,
            BedrockSoftware::PowerNukkitX => &self.powernukkitx,
        }
    }
}

pub(crate) struct MinecraftBedrockTemplate;

impl Template for MinecraftBedrockTemplate {
    const ID: &'static str = "minecraft_bedrock";
    type Extra = MinecraftBedrockExtra;
    type Cache = BedrockVersionCache;

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
            backup_exclude: extra.software.backup_exclude(),
            files_write: extra.software.files_write(),
            uid: None,
            gid: None,
            stop_command: Some("stop".to_owned()),
            stop_timeout: 60,
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let version = cache
            .vanilla
            .first()
            .ok_or(ThinTemplateError::Unavailable)?;

        Ok(MinecraftBedrockExtra {
            software: BedrockSoftware::Vanilla,
            version: version.clone(),
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
                placeholder: "Bedrock".to_owned(),
                remappable: true,
                http: false,
            },
        )]))
    }

    async fn extra_to_variables(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<VariablePayload, TemplateError> {
        let versions: HashMap<BedrockSoftware, Vec<String>> = BedrockSoftware::ALL
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
                VariableDataBuilder::new(BedrockSoftware::ALL.to_vec())
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
                VariableGroupBuilder::new(Some("Bedrock version"))
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
            .and_then(|value| BedrockSoftware::from_label(value))
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

        Ok(Some(MinecraftBedrockExtra {
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
        self.primary_port0(ports, SERVER_PORT, NetworkProtocol::Udp)
            .await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    fn licenses(&self) -> &'static [&'static License] {
        &[&MINECRAFT_EULA]
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .inspect_err(|err| {
                error!("Unable to build cache update client (for minecraft bedrock): {err:?}");
            })
            .map_err(|_err| ())?;

        Ok(BedrockVersionCache {
            vanilla: resolve_vanilla(&client).await?,
            pocketmine: resolve_github_releases(&client, POCKETMINE_RELEASES).await?,
            powernukkitx: resolve_github_releases(&client, POWERNUKKITX_RELEASES).await?,
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
struct BedrockDownloadLinks {
    result: BedrockDownloadLinksResult,
}

#[derive(Deserialize)]
struct BedrockDownloadLinksResult {
    links: Vec<BedrockDownloadLink>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BedrockDownloadLink {
    download_type: String,
    download_url: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

async fn resolve_vanilla(client: &reqwest::Client) -> Result<Vec<String>, ()> {
    let links: BedrockDownloadLinks = client
        .get(BEDROCK_DOWNLOAD_LINKS)
        .send()
        .await
        .inspect_err(|err| error!("Unable to send bedrock download links request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get bedrock download links: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive bedrock download links: {err:?}"))
        .map_err(|_err| ())?;

    let version = links
        .result
        .links
        .into_iter()
        .find(|link| link.download_type == "serverBedrockLinux")
        .and_then(|link| {
            BEDROCK_URL_VERSION_REGEX
                .captures(&link.download_url)
                .and_then(|captures| captures.get(1))
                .map(|version| version.as_str().to_owned())
        })
        .ok_or_else(|| error!("No linux bedrock server download link found"))?;

    Ok(vec![version])
}

async fn resolve_github_releases(client: &reqwest::Client, url: &str) -> Result<Vec<String>, ()> {
    let releases: Vec<GithubRelease> = client
        .get(url)
        .query(&[("per_page", "50")])
        .send()
        .await
        .inspect_err(|err| error!("Unable to send github releases request ({url}): {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get github releases ({url}): {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive github releases ({url}): {err:?}"))
        .map_err(|_err| ())?;

    let versions: Vec<String> = releases
        .into_iter()
        .filter(|release| {
            !release.draft && !release.prerelease && VERSION_REGEX.is_match(&release.tag_name)
        })
        .map(|release| release.tag_name)
        .take(MAX_RELEASES)
        .collect();

    if versions.is_empty() {
        error!("No releases found ({url})");
        return Err(());
    }

    Ok(versions)
}
