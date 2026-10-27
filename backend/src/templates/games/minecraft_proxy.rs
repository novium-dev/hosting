mod bungeecord;
mod velocity;

use chrono::{TimeDelta, TimeZone as _, Utc};
use core::fmt::{Debug, Display, Formatter};
use daemon_common::service::server::{
    Patch, PatchEntry, PatchSet, ServerBuildImage, ServerBuildPayload, ServerFileWrite,
};
use indexmap::IndexSet;
use redis::RedisError;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use serde_json::json;
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::{debug, error};

use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::templates::games::minecraft::{
    JAVA_PREFIX, JAVA_RECOMMENDED, VersionBuild, WORK_TMP_SETUP,
};
use crate::templates::variable::{
    VariableBuilder, VariableContent, VariableDataBuilder, VariableGroupBuilder, VariablePayload,
};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};
use crate::utils::serde::SerdePrimitive;

pub(crate) const VELOCITY_URL: &str = "https://fill.papermc.io/";
pub(crate) const BUNGEECORD_URL: &str = "https://hub.spigotmc.org/jenkins/";

const DEFAULT_JAVA: u8 = 21;
const BUNGEECORD_JAVA: u8 = 21;
const PROXY_PORT: u16 = 25577;
const PROXY_PORT_NAME: &str = "minecraft";

#[derive(Debug, Readable, Writable, Hash, Ord, PartialOrd, Eq, PartialEq, Copy, Clone)]
pub(crate) enum MinecraftProxySoftware {
    Velocity,
    BungeeCord,
}

impl Display for MinecraftProxySoftware {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> core::fmt::Result {
        <Self as Debug>::fmt(self, formatter)
    }
}

const SOFTWARE: [MinecraftProxySoftware; 2] = [
    MinecraftProxySoftware::Velocity,
    MinecraftProxySoftware::BungeeCord,
];

#[derive(Serialize, Deserialize)]
#[serde(tag = "software")]
pub(crate) enum MinecraftProxyExtra {
    #[serde(rename = "velocity")]
    Velocity {
        java: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        java_pinned: Option<bool>,
        velocity_version: String,
        velocity_build: u16,
    },
    #[serde(rename = "bungeecord")]
    BungeeCord {
        java: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        java_pinned: Option<bool>,
        bungeecord_build: u16,
    },
}

impl MinecraftProxyExtra {
    const REL: usize = 1;

    pub(crate) const fn software(&self) -> MinecraftProxySoftware {
        match self {
            Self::Velocity { .. } => MinecraftProxySoftware::Velocity,
            Self::BungeeCord { .. } => MinecraftProxySoftware::BungeeCord,
        }
    }

    pub(crate) const fn java(&self) -> u8 {
        match self {
            Self::Velocity { java, .. } | Self::BungeeCord { java, .. } => *java,
        }
    }

    pub(crate) const fn java_pinned(&self) -> Option<bool> {
        match self {
            Self::Velocity { java_pinned, .. } | Self::BungeeCord { java_pinned, .. } => {
                *java_pinned
            }
        }
    }

    pub(crate) fn proxy_version(&self) -> String {
        match self {
            Self::Velocity {
                velocity_version, ..
            } => velocity_version.clone(),
            Self::BungeeCord {
                bungeecord_build, ..
            } => bungeecord_build.to_string(),
        }
    }

    pub(crate) fn proxy_build(&self) -> Option<String> {
        match self {
            Self::Velocity { velocity_build, .. } => Some(velocity_build.to_string()),
            Self::BungeeCord { .. } => None,
        }
    }

    fn backup_exclude(&self) -> HashSet<String> {
        match self {
            Self::Velocity { .. } => HashSet::from(["logs/".to_owned()]),
            Self::BungeeCord { .. } => HashSet::from(["logs/".to_owned(), "modules/".to_owned()]),
        }
    }

    fn files_write(&self) -> HashMap<String, ServerFileWrite> {
        match self {
            Self::Velocity { .. } => HashMap::from([(
                "velocity.toml".to_owned(),
                ServerFileWrite::Toml {
                    set: vec![PatchSet {
                        condition: Patch(vec![]),
                        patch: PatchEntry::Merge {
                            patch: json!({ "bind": format!("0.0.0.0:{PROXY_PORT}") }),
                        },
                    }],
                },
            )]),
            Self::BungeeCord { .. } => HashMap::new(),
        }
    }

    const fn stop_command(&self) -> &'static str {
        match self {
            Self::Velocity { .. } => "shutdown",
            Self::BungeeCord { .. } => "end",
        }
    }

    pub(crate) fn identifier(&self) -> String {
        match self {
            Self::Velocity {
                java,
                velocity_version,
                velocity_build,
                ..
            } => format!(
                "minecraft_proxy_velocity-{}-{}-jre{}-r{}",
                velocity_version,
                velocity_build,
                java,
                Self::REL
            ),
            Self::BungeeCord {
                java,
                bungeecord_build,
                ..
            } => format!(
                "minecraft_proxy_bungeecord-{}-jre{}-r{}",
                bungeecord_build,
                java,
                Self::REL
            ),
        }
    }

    pub(crate) fn image(&self) -> ServerBuildImage {
        let generic = ServerBuildImage {
            dockerfile: include_str!("minecraft/generic.Dockerfile").to_owned(),
            args: HashMap::from([("MC_MONITOR_DEFAULT_PORT".to_owned(), PROXY_PORT.to_string())]),
            parents: Vec::new(),
            tag: None,
            default_tag: Some(format!("minecraft_proxy-generic-r{}", Self::REL)),
            base: None,
        };
        let java = ServerBuildImage {
            dockerfile: include_str!("minecraft/java.Dockerfile").to_owned(),
            args: HashMap::from([("JAVA".to_owned(), self.java().to_string())]),
            parents: vec![generic],
            tag: Some(format!(
                "minecraft_proxy-jre-{}-r{}",
                self.java(),
                Self::REL
            )),
            default_tag: None,
            base: Some(0),
        };

        let dockerfile = match self.software() {
            MinecraftProxySoftware::Velocity => {
                include_str!("minecraft_proxy/velocity.Dockerfile")
            }
            MinecraftProxySoftware::BungeeCord => {
                include_str!("minecraft_proxy/bungeecord.Dockerfile")
            }
        };

        let args: HashMap<String, SerdePrimitive> = serde_json::from_value(
            serde_json::to_value(self).expect("Unable to convert extra to json"),
        )
        .expect("Unable to convert json by extra to map");
        let args: HashMap<String, String> = args
            .into_iter()
            .map(|(key, val)| (key.to_uppercase(), val.to_string()))
            .filter(|(key, _)| !matches!(&**key, "JAVA" | "JAVA_PINNED" | "SOFTWARE"))
            .collect();

        ServerBuildImage {
            dockerfile: format!("{dockerfile}{WORK_TMP_SETUP}"),
            parents: vec![java],
            default_tag: None,
            tag: Some(self.identifier()),
            args,
            base: Some(0),
        }
    }
}

#[derive(Readable, Writable, Clone)]
pub(crate) struct VelocityVersion {
    pub(crate) id: String,
    pub(crate) java: u8,
    pub(crate) builds: VersionBuild,
}

#[derive(Readable, Writable)]
pub(crate) struct ProxyVersionCache {
    pub(crate) velocity: Vec<VelocityVersion>,
    pub(crate) bungeecord: Vec<u16>,
    pub(crate) updated: i64,
}

impl ProxyVersionCache {
    fn recommended_java(&self, extra: &MinecraftProxyExtra) -> u8 {
        match extra {
            MinecraftProxyExtra::Velocity {
                velocity_version, ..
            } => self
                .velocity
                .iter()
                .find(|version| version.id.eq(velocity_version))
                .map_or(DEFAULT_JAVA, |version| version.java),
            MinecraftProxyExtra::BungeeCord { .. } => BUNGEECORD_JAVA,
        }
    }

    fn java_versions(&self) -> Vec<u8> {
        let mut versions: Vec<u8> = self
            .velocity
            .iter()
            .map(|version| version.java)
            .chain(core::iter::once(BUNGEECORD_JAVA))
            .collect();
        versions.sort_unstable_by(|left, right| right.cmp(left));
        versions.dedup();
        versions
    }
}

fn build_content(builds: VersionBuild) -> VariableContent {
    match builds {
        VersionBuild::Range(prefix, range_start, range_end, exclude) => {
            VariableContent::NumberRange {
                prefix,
                range_start,
                range_end,
                exclude,
            }
        }
        VersionBuild::Set(content) => VariableContent::StringSet {
            content: IndexSet::from_iter(content),
        },
    }
}

pub(crate) struct MinecraftProxyTemplate;

impl Template for MinecraftProxyTemplate {
    const ID: &'static str = "minecraft_proxy";
    type Extra = MinecraftProxyExtra;
    type Cache = ProxyVersionCache;

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
            backup_exclude: extra.backup_exclude(),
            files_write: extra.files_write(),

            uid: None,
            gid: None,

            stop_command: Some(extra.stop_command().to_owned()),
            stop_timeout: 60,
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let version = cache
            .velocity
            .first()
            .ok_or(ThinTemplateError::Unavailable)?;
        let VersionBuild::Range(_, _, range_end, _) = version.builds else {
            return Err(ThinTemplateError::Unavailable);
        };

        Ok(MinecraftProxyExtra::Velocity {
            java: version.java,
            java_pinned: Some(false),
            velocity_version: version.id.clone(),
            velocity_build: range_end,
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([(
            PROXY_PORT_NAME.to_owned(),
            TemplatePortDefinition {
                protocol: NetworkProtocol::Tcp,
                internal_port: PROXY_PORT,
                placeholder: "Proxy".to_owned(),
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
        let velocity = cache.velocity.clone();
        let bungeecord = cache.bungeecord.clone();

        let java_versions = cache.java_versions();
        let mut java_set: IndexSet<String> = java_versions
            .iter()
            .map(|version| format!("{JAVA_PREFIX}{version}"))
            .collect();
        java_set.insert_before(0, JAVA_RECOMMENDED.to_owned());
        let recommended_java = cache.recommended_java(&extra);

        Ok(VariableBuilder::default()
            .data(
                VariableDataBuilder::new(SOFTWARE.to_vec())
                    .layer_base_impl()
                    .layer::<2, _, _>(move |software| match *software {
                        MinecraftProxySoftware::Velocity => velocity
                            .iter()
                            .map(|version| {
                                (version.id.clone(), build_content(version.builds.clone()))
                            })
                            .collect(),
                        MinecraftProxySoftware::BungeeCord => bungeecord
                            .iter()
                            .map(|build| (build.to_string(), VariableContent::Disabled {}))
                            .collect(),
                    }),
            )
            .group(
                VariableGroupBuilder::new(Some("Proxy version"))
                    .hierarchy_variable(
                        "software",
                        "Software",
                        Some(extra.software().to_string()),
                        0,
                        0,
                    )
                    .hierarchy_variable(
                        "proxy_version",
                        "Version",
                        Some(extra.proxy_version()),
                        1,
                        0,
                    )
                    .hierarchy_variable("proxy_build", "Build", extra.proxy_build(), 2, 0),
            )
            .group(
                VariableGroupBuilder::new(Some("Java Runtime Environment")).static_variable(
                    "java",
                    "Java",
                    Some(
                        if extra
                            .java_pinned()
                            .unwrap_or_else(|| recommended_java != extra.java())
                            && java_versions.contains(&extra.java())
                        {
                            format!("{JAVA_PREFIX}{}", extra.java())
                        } else {
                            JAVA_RECOMMENDED.to_owned()
                        },
                    ),
                    java_set,
                ),
            )
            .into_payload())
    }

    async fn variables_to_extra_validated(
        &self,
        cache: &Self::Cache,
        _old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> Result<Option<Self::Extra>, TemplateError> {
        let Some(software_raw) = variables.get("software") else {
            debug!("Variables rejected: software missing");
            return Ok(None);
        };
        let Some(proxy_version) = variables.get("proxy_version") else {
            debug!("Variables rejected: proxy_version missing");
            return Ok(None);
        };
        let Some(java_raw) = variables.get("java") else {
            debug!("Variables rejected: java missing");
            return Ok(None);
        };

        let Some(software) = SOFTWARE
            .iter()
            .find(|software| software.to_string().eq(software_raw))
        else {
            debug!("Variables rejected: software not found");
            return Ok(None);
        };

        let (java_override, java_pinned) = if java_raw.eq(JAVA_RECOMMENDED) {
            (None, Some(false))
        } else {
            let Some(java) = java_raw
                .strip_prefix(JAVA_PREFIX)
                .and_then(|java| java.parse::<u8>().ok())
                .filter(|java| cache.java_versions().contains(java))
            else {
                debug!("Variables rejected: invalid java: {java_raw:?}");
                return Ok(None);
            };
            (Some(java), Some(true))
        };

        let extra = match *software {
            MinecraftProxySoftware::Velocity => {
                let Some(version) = cache
                    .velocity
                    .iter()
                    .find(|version| version.id.eq(proxy_version))
                else {
                    debug!("Variables rejected: invalid velocity version: {proxy_version:?}");
                    return Ok(None);
                };
                let VersionBuild::Range(_, range_start, range_end, ref exclude) = version.builds
                else {
                    debug!("Variables rejected: velocity builds are not a range");
                    return Ok(None);
                };
                let Some(build_raw) = variables.get("proxy_build") else {
                    debug!("Variables rejected: proxy_build missing");
                    return Ok(None);
                };
                let Ok(build) = build_raw.parse::<u16>() else {
                    debug!("Variables rejected: Not an integer: {build_raw:?}");
                    return Ok(None);
                };
                if !(range_start..=range_end).contains(&build) || exclude.contains(&build) {
                    debug!("Variables rejected: Not in range {range_start}..={range_end}: {build}");
                    return Ok(None);
                }

                MinecraftProxyExtra::Velocity {
                    java: java_override.unwrap_or(version.java),
                    java_pinned,
                    velocity_version: version.id.clone(),
                    velocity_build: build,
                }
            }
            MinecraftProxySoftware::BungeeCord => {
                let Ok(build) = proxy_version.parse::<u16>() else {
                    debug!("Variables rejected: Not an integer: {proxy_version:?}");
                    return Ok(None);
                };
                if !cache.bungeecord.contains(&build) {
                    debug!("Variables rejected: unknown bungeecord build: {build}");
                    return Ok(None);
                }

                MinecraftProxyExtra::BungeeCord {
                    java: java_override.unwrap_or(BUNGEECORD_JAVA),
                    java_pinned,
                    bungeecord_build: build,
                }
            }
        };

        Ok(Some(extra))
    }

    async fn enabled_features(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        Ok(HashSet::from([
            "minecraft_monitor",
            match extra.software() {
                MinecraftProxySoftware::Velocity => "minecraft_plugins_velocity",
                MinecraftProxySoftware::BungeeCord => "minecraft_plugins_bungeecord",
            },
        ]))
    }

    async fn primary_port(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
        ports: &HashMap<u32, ServerPort>,
    ) -> Option<(u32, ServerPort, u16)> {
        self.primary_port0(ports, PROXY_PORT, NetworkProtocol::Tcp)
            .await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        resolve_cache().await
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        Utc::now() > (Utc.timestamp_millis_opt(cache.updated).unwrap() + TimeDelta::days(1))
    }
}

pub(crate) async fn resolve_cache() -> Result<ProxyVersionCache, ()> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("novium-backend/", env!("CARGO_PKG_VERSION")))
        .build()
        .inspect_err(|err| {
            error!("Unable to build cache update client (for minecraft proxies): {err:?}");
        })
        .map_err(|_err| ())?;

    Ok(ProxyVersionCache {
        velocity: velocity::resolve(&client, VELOCITY_URL).await?,
        bungeecord: bungeecord::resolve(&client, BUNGEECORD_URL).await?,
        updated: Utc::now().timestamp_millis(),
    })
}
