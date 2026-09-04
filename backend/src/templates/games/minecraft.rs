mod fabric;
mod forge;
pub(crate) mod maven;
mod neoforge;
mod paper;
mod purpur;

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

use crate::db::license::{License, MINECRAFT_EULA};
use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::templates::variable::{
    VariableBuilder, VariableContent, VariableDataBuilder, VariableGroupBuilder, VariablePayload,
};
use crate::templates::{
    STARTUP_COMMAND_ENVIRONMENT, Template, TemplateError, TemplatePortDefinition, ThinTemplateError,
};

use crate::utils::serde::SerdePrimitive;

pub(crate) const JVM_FLAGS: &str =
    "-Dterminal.ansi=true -Djava.net.preferIPv6Addresses=system -XX:MaxRAMPercentage=95.0";
pub(crate) const PAPER_URL: &str = "https://fill.papermc.io/";
pub(crate) const PURPUR_URL: &str = "https://api.purpurmc.org/";
pub(crate) const FABRIC_URL: &str = "https://meta.fabricmc.net/v2";
pub(crate) const QUILT_URL: &str = "https://meta.quiltmc.org/v3";
pub(crate) const FORGE_URL: &str = "https://maven.minecraftforge.net";
pub(crate) const NEOFORGE_URL: &str = "https://maven.neoforged.net";

#[derive(Debug, Readable, Writable, Hash, Ord, PartialOrd, Eq, PartialEq, Copy, Clone)]
pub(crate) enum MinecraftServerModification {
    Vanilla,
    Paper,
    Purpur,
    Fabric,
    Quilt,
    NeoForge,
}

impl Display for MinecraftServerModification {
    fn fmt(&self, f: &mut Formatter<'_>) -> core::fmt::Result {
        <Self as Debug>::fmt(self, f)
    }
}

pub(crate) enum MinecraftDownloadBackend {
    Vanilla,
    Paper(&'static str, &'static str),
    Purpur(&'static str, &'static str),
    Fabric(&'static str),
    Forge(&'static str),
    NeoForge(&'static str),
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "software")]
pub(crate) enum MinecraftServerExtra {
    #[serde(rename = "vanilla")]
    Vanilla {
        java: u8,
        minecraft_version: String,
        data_pack: bool,
    },
    #[serde(rename = "paper")]
    Paper {
        java: u8,
        minecraft_version: String,
        paper_build: u16,
        data_pack: bool,
    },
    #[serde(rename = "purpur")]
    Purpur {
        java: u8,
        minecraft_version: String,
        purpur_build: u16,
        data_pack: bool,
    },
    #[serde(rename = "fabric")]
    Fabric {
        java: u8,
        minecraft_version: String,
        loader_version: String,
        data_pack: bool,
    },
    #[serde(rename = "quilt")]
    Quilt {
        java: u8,
        minecraft_version: String,
        loader_version: String,
        data_pack: bool,
    },
    #[serde(rename = "neoforge")]
    NeoForge {
        java: u8,
        minecraft_version: String,
        loader_version: String,
        data_pack: bool,
    },
}

impl MinecraftServerModification {
    fn backup_exclude(self) -> HashSet<String> {
        match self {
            Self::Vanilla | Self::Fabric | Self::Quilt | Self::NeoForge => HashSet::new(),
            Self::Paper | Self::Purpur => HashSet::from([
                "cache/".to_owned(),
                "libraries/".to_owned(),
                "versions/".to_owned(),
            ]),
        }
    }

    const fn backend(self) -> MinecraftDownloadBackend {
        match self {
            Self::Vanilla => MinecraftDownloadBackend::Vanilla,
            Self::Paper => MinecraftDownloadBackend::Paper("paper", PAPER_URL),
            Self::Purpur => MinecraftDownloadBackend::Purpur("purpur", PURPUR_URL),
            Self::Fabric => MinecraftDownloadBackend::Fabric(FABRIC_URL),
            Self::Quilt => MinecraftDownloadBackend::Fabric(QUILT_URL),
            Self::NeoForge => MinecraftDownloadBackend::NeoForge(NEOFORGE_URL),
        }
    }

    const fn is_paper(self) -> bool {
        matches!(self, Self::Paper | Self::Purpur)
    }

    const fn is_fabric(self) -> bool {
        matches!(self, Self::Fabric | Self::Quilt)
    }

    #[expect(clippy::unused_self, reason = "forge is unimplemented")]
    const fn is_forge(self) -> bool {
        false
    }

    const fn is_neoforge(self) -> bool {
        matches!(self, Self::NeoForge)
    }
}

impl MinecraftServerExtra {
    const REL: usize = 2;

    pub(crate) const fn modification(&self) -> MinecraftServerModification {
        match self {
            Self::Vanilla { .. } => MinecraftServerModification::Vanilla,
            Self::Paper { .. } => MinecraftServerModification::Paper,
            Self::Purpur { .. } => MinecraftServerModification::Purpur,
            Self::Fabric { .. } => MinecraftServerModification::Fabric,
            Self::Quilt { .. } => MinecraftServerModification::Quilt,
            Self::NeoForge { .. } => MinecraftServerModification::NeoForge,
        }
    }

    pub(crate) fn startup_command(&self) -> String {
        let modules = match self.modification() {
            MinecraftServerModification::Purpur => "--add-modules=jdk.incubator.vector ",
            _ => "",
        };
        let launch = match self.modification() {
            MinecraftServerModification::Fabric => {
                "-Dfabric.gameJarPath=/server.jar -jar /fabric-server-launch.jar"
            }
            MinecraftServerModification::Quilt => {
                "-Dloader.gameJarPath=/server.jar -jar /quilt-server-launch.jar"
            }
            MinecraftServerModification::NeoForge => "$(cat /args.txt)",
            _ => "-jar /server.jar",
        };

        format!("java {modules}{JVM_FLAGS} {launch}")
    }

    pub(crate) fn image(&self) -> ServerBuildImage {
        let generic = ServerBuildImage {
            dockerfile: include_str!("minecraft/generic.Dockerfile").to_owned(),
            args: HashMap::new(),
            parents: Vec::new(),
            tag: None,
            default_tag: Some(format!("minecraft-generic-r{}", Self::REL)),
            base: None,
        };
        let java = ServerBuildImage {
            dockerfile: include_str!("minecraft/java.Dockerfile").to_owned(),
            args: HashMap::from([("JAVA".to_owned(), self.java().to_string())]),
            parents: vec![generic],
            tag: Some(format!("minecraft-jre-{}-r{}", self.java(), Self::REL)),
            default_tag: None,
            base: Some(0),
        };

        let dockerfile = match self.modification() {
            MinecraftServerModification::Vanilla => include_str!("minecraft/vanilla.Dockerfile"),
            MinecraftServerModification::Paper => include_str!("minecraft/paper.Dockerfile"),
            MinecraftServerModification::Purpur => include_str!("minecraft/purpur.Dockerfile"),
            MinecraftServerModification::Fabric => include_str!("minecraft/fabric.Dockerfile"),
            MinecraftServerModification::Quilt => include_str!("minecraft/quilt.Dockerfile"),
            MinecraftServerModification::NeoForge => include_str!("minecraft/neoforge.Dockerfile"),
        };
        let mut parents = vec![java];
        if self.modification().is_paper() {
            parents = vec![ServerBuildImage {
                args: HashMap::new(),
                default_tag: None,
                tag: Some(format!(
                    "minecraft-paper_like-jre{}-r{}",
                    self.java(),
                    Self::REL
                )),
                parents,
                base: Some(0),
                dockerfile: include_str!("minecraft/paper_like.Dockerfile").to_owned(),
            }];
        }

        let args: HashMap<String, SerdePrimitive> = serde_json::from_value(
            serde_json::to_value(self).expect("Unable to convert extra to json"),
        )
        .expect("Unable to convert json by extra to map");
        let args: HashMap<String, String> = args
            .into_iter()
            .map(|(key, val)| (key.to_uppercase(), val.to_string()))
            .filter(|(key, _)| !matches!(&**key, "JAVA" | "DATA_PACK" | "SOFTWARE"))
            .collect();

        ServerBuildImage {
            dockerfile: dockerfile.to_owned(),
            parents,
            default_tag: None,
            tag: Some(self.identifier()),
            args,
            base: Some(0),
        }
    }

    const fn supports_datapacks(&self) -> bool {
        match self {
            Self::Vanilla { data_pack, .. }
            | Self::Paper { data_pack, .. }
            | Self::Purpur { data_pack, .. }
            | Self::Fabric { data_pack, .. }
            | Self::Quilt { data_pack, .. }
            | Self::NeoForge { data_pack, .. } => *data_pack,
        }
    }

    pub(crate) fn files_write(&self) -> HashMap<String, ServerFileWrite> {
        let mut result = HashMap::from([
            (
                "server.properties".to_owned(),
                ServerFileWrite::JavaProperties {
                    content: HashMap::from([
                        ("enable-rcon".to_owned(), "true".to_owned()),
                        ("rcon.port".to_owned(), "25575".to_owned()),
                        ("rcon.password".to_owned(), "_".to_owned()),
                        ("rcon.ip".to_owned(), "::1".to_owned()),
                    ]),
                },
            ),
            (
                "eula.txt".to_owned(),
                ServerFileWrite::JavaProperties {
                    content: HashMap::from([("eula".to_owned(), "true".to_owned())]),
                },
            ),
        ]);
        result.extend(match self {
            Self::Paper { .. } | Self::Purpur { .. } => HashMap::from([(
                "spigot.yml".to_owned(),
                ServerFileWrite::Yaml {
                    set: vec![PatchSet {
                        condition: Patch(vec![]),
                        patch: PatchEntry::Merge {
                            patch: json!({
                                "settings": {
                                    "restart-script": "/restart.sh"
                                }
                            }),
                        },
                    }],
                },
            )]),
            _ => HashMap::new(),
        });
        result
    }

    pub(crate) fn minecraft_version(&self) -> String {
        match self {
            Self::Vanilla {
                minecraft_version, ..
            }
            | Self::Paper {
                minecraft_version, ..
            }
            | Self::Purpur {
                minecraft_version, ..
            }
            | Self::Fabric {
                minecraft_version, ..
            }
            | Self::Quilt {
                minecraft_version, ..
            }
            | Self::NeoForge {
                minecraft_version, ..
            } => minecraft_version.clone(),
        }
    }

    pub(crate) const fn java(&self) -> u8 {
        match self {
            Self::Vanilla { java, .. }
            | Self::Paper { java, .. }
            | Self::Purpur { java, .. }
            | Self::Fabric { java, .. }
            | Self::Quilt { java, .. }
            | Self::NeoForge { java, .. } => *java,
        }
    }

    pub(crate) fn mod_build(&self) -> Option<String> {
        match self {
            Self::Vanilla { .. } => None,
            Self::Paper { paper_build, .. } => Some(paper_build.to_string()),
            Self::Purpur { purpur_build, .. } => Some(purpur_build.to_string()),
            Self::Fabric { loader_version, .. }
            | Self::Quilt { loader_version, .. }
            | Self::NeoForge { loader_version, .. } => Some(loader_version.clone()),
        }
    }

    pub(crate) fn identifier(&self) -> String {
        match self {
            Self::Vanilla {
                java,
                minecraft_version,
                ..
            } => format!(
                "minecraft_vanilla-{}-jre{}-r{}",
                minecraft_version,
                java,
                Self::REL
            ),
            Self::Paper {
                java,
                minecraft_version,
                paper_build,
                ..
            } => format!(
                "minecraft_paper-{}-{}-jre{}-r{}",
                minecraft_version,
                paper_build,
                java,
                Self::REL
            ),
            Self::Purpur {
                java,
                minecraft_version,
                purpur_build,
                ..
            } => format!(
                "minecraft_purpur-{}-{}-jre{}-r{}",
                minecraft_version,
                purpur_build,
                java,
                Self::REL
            ),
            Self::Fabric {
                java,
                minecraft_version,
                loader_version,
                ..
            } => format!(
                "minecraft_fabric-{}-{}-jre{}-r{}",
                minecraft_version,
                loader_version,
                java,
                Self::REL
            ),
            Self::Quilt {
                java,
                minecraft_version,
                loader_version,
                ..
            } => format!(
                "minecraft_quilt-{}-{}-jre{}-r{}",
                minecraft_version,
                loader_version,
                java,
                Self::REL
            ),
            Self::NeoForge {
                java,
                minecraft_version,
                loader_version,
                ..
            } => format!(
                "minecraft_neoforge-{}-{}-jre{}-r{}",
                minecraft_version,
                loader_version,
                java,
                Self::REL
            ),
        }
    }
}

const MODS: [MinecraftServerModification; 6] = [
    MinecraftServerModification::Vanilla,
    MinecraftServerModification::Paper,
    MinecraftServerModification::Purpur,
    MinecraftServerModification::Fabric,
    MinecraftServerModification::Quilt,
    MinecraftServerModification::NeoForge,
];

pub(crate) struct MinecraftTemplate;

impl Template for MinecraftTemplate {
    const ID: &'static str = "minecraft";
    type Extra = MinecraftServerExtra;
    type Cache = VersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let backup_exclude = extra.modification().backup_exclude();

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
            environment: HashMap::from([(
                STARTUP_COMMAND_ENVIRONMENT.to_owned(),
                extra.startup_command(),
            )]),
            backup_exclude,
            files_write: extra.files_write(),

            uid: None,
            gid: None,

            stop_command: if extra.modification().is_paper() {
                None
            } else {
                Some("stop".to_owned())
            },
            stop_timeout: 120,
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let mut current = cache
            .0
            .iter()
            .map(|(ver, (index, recommended_java, data_pack, map))| {
                (index, ver, recommended_java, data_pack, map)
            })
            .collect::<Vec<_>>();
        current.sort_by_key(|key| key.0);
        let current = current
            .into_iter()
            .next()
            .ok_or(ThinTemplateError::Unavailable)?;
        Ok(MinecraftServerExtra::Vanilla {
            java: *current.2,
            minecraft_version: current.1.clone(),
            data_pack: *current.3,
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([(
            "minecraft".to_owned(),
            TemplatePortDefinition {
                protocol: NetworkProtocol::Tcp,
                internal_port: 25565,
                placeholder: "Minecraft".to_owned(),
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
        let mut current = cache
            .0
            .iter()
            .map(|(ver, (index, recommended_java, _data_pack, map))| {
                (index, ver, recommended_java, map)
            })
            .collect::<Vec<_>>();
        current.sort_by_key(|key| key.0);
        let java_versions: IndexSet<_> = current.iter().map(|(_, _, java, _)| **java).collect();
        let recommended_java = cache
            .0
            .get(&extra.minecraft_version())
            .map(|(_, java, _, _)| *java);
        let mut java_set: IndexSet<String> = java_versions
            .iter()
            .map(|version| format!("Java {version}"))
            .collect();
        java_set.insert_before(0, "Recommended".to_owned());

        Ok(VariableBuilder::default()
            .data(
                VariableDataBuilder::new(MODS.to_vec())
                    .layer_base_impl()
                    .layer::<2, _, _>(move |modification| {
                        let mut vec = Vec::new();
                        for (_, ver, _, map) in &current {
                            match *modification {
                                MinecraftServerModification::Vanilla => {
                                    vec.push(((*ver).clone(), VariableContent::Disabled {}));
                                }
                                _ => {
                                    if let Some(build) = map.get(modification) {
                                        vec.push((
                                            (*ver).clone(),
                                            match build.clone() {
                                                VersionBuild::Range(
                                                    prefix,
                                                    range_start,
                                                    range_end,
                                                    exclude,
                                                ) => VariableContent::NumberRange {
                                                    prefix,
                                                    range_start,
                                                    range_end,
                                                    exclude,
                                                },
                                                VersionBuild::Set(content) => {
                                                    VariableContent::StringSet {
                                                        content: IndexSet::from_iter(content),
                                                    }
                                                }
                                            },
                                        ));
                                    }
                                }
                            }
                        }
                        vec
                    }),
            )
            .group(
                VariableGroupBuilder::new(Some("Minecraft version"))
                    .hierarchy_variable(
                        "software",
                        "Software",
                        Some(extra.modification().to_string()),
                        0,
                        0,
                    )
                    .hierarchy_variable(
                        "minecraft_version",
                        "Minecraft version",
                        Some(extra.minecraft_version()),
                        1,
                        0,
                    )
                    .hierarchy_variable("mod_build", "Software build", extra.mod_build(), 2, 0),
            )
            .group(
                VariableGroupBuilder::new(Some("Java Runtime Environment")).static_variable(
                    "java",
                    "Java",
                    Some(match recommended_java {
                        Some(java) if java_versions.contains(&java) && java != extra.java() => {
                            format!("Java {}", extra.java())
                        }
                        _ => "Recommended".to_owned(),
                    }),
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
        let Some(minecraft_version) = variables.get("minecraft_version") else {
            debug!("Variables rejected: minecraft_version missing");
            return Ok(None);
        };
        let mod_build_raw = variables.get("mod_build");
        let Some(java_raw) = variables.get("java") else {
            debug!("Variables rejected: java missing");
            return Ok(None);
        };

        let Some(software) = MODS
            .iter()
            .find(|modification| modification.to_string().eq(software_raw))
        else {
            debug!("Variables rejected: software not found");
            return Ok(None);
        };

        let Some((_, recommended_java, data_pack, map)) = cache.0.get(minecraft_version) else {
            debug!("Variables rejected: invalid minecraft version: {minecraft_version:?}");
            return Ok(None);
        };
        let java = match java_raw.as_str() {
            "Recommended" => *recommended_java,
            "Java 25" => 25,
            "Java 21" => 21,
            "Java 17" => 17,
            "Java 11" => 11,
            "Java 8" => 8,
            _ => {
                debug!("Variables rejected: invalid java: {java_raw:?}");
                return Ok(None);
            }
        };
        if *software == MinecraftServerModification::Vanilla {
            Ok(Some(MinecraftServerExtra::Vanilla {
                java,
                minecraft_version: minecraft_version.clone(),
                data_pack: *data_pack,
            }))
        } else {
            let Some(mod_versions) = map.get(software) else {
                debug!("Variables rejected: software not found");
                return Ok(None);
            };
            let Some(mut mod_build) = mod_build_raw.map(|str| &**str) else {
                debug!("Variables rejected: mod_build missing");
                return Ok(None);
            };
            match mod_versions {
                VersionBuild::Range(prefix, range_start, range_end, exclude) => {
                    let mod_build_full = mod_build.to_owned();
                    if let Some(prefix) = prefix {
                        let Some(mod_build_stripped) = mod_build.strip_prefix(prefix) else {
                            debug!(
                                "Variables rejected: Does not start with prefix {prefix:?}: {mod_build:?}"
                            );
                            return Ok(None);
                        };
                        mod_build = mod_build_stripped;
                    }
                    let Ok(mod_build) = mod_build.parse::<u16>() else {
                        debug!("Variables rejected: Not an integer: {mod_build:?}");
                        return Ok(None);
                    };

                    if !(*range_start..=*range_end).contains(&mod_build)
                        || exclude.contains(&mod_build)
                    {
                        debug!(
                            "Variables rejected: Not in range {range_start}..={range_end}: {mod_build}"
                        );
                        return Ok(None);
                    }

                    Ok(match software {
                        MinecraftServerModification::Vanilla => unreachable!(),
                        MinecraftServerModification::Paper => Some(MinecraftServerExtra::Paper {
                            java,
                            minecraft_version: minecraft_version.clone(),
                            paper_build: mod_build,
                            data_pack: *data_pack,
                        }),
                        MinecraftServerModification::Purpur => Some(MinecraftServerExtra::Purpur {
                            java,
                            minecraft_version: minecraft_version.clone(),
                            purpur_build: mod_build,
                            data_pack: *data_pack,
                        }),
                        MinecraftServerModification::NeoForge => {
                            Some(MinecraftServerExtra::NeoForge {
                                java,
                                minecraft_version: minecraft_version.clone(),
                                loader_version: mod_build_full,
                                data_pack: *data_pack,
                            })
                        }
                        MinecraftServerModification::Fabric
                        | MinecraftServerModification::Quilt => None,
                    })
                }
                VersionBuild::Set(versions) => {
                    if !versions.contains(&mod_build.to_owned()) {
                        return Ok(None);
                    }
                    Ok(match software {
                        MinecraftServerModification::Fabric => Some(MinecraftServerExtra::Fabric {
                            java,
                            minecraft_version: minecraft_version.clone(),
                            loader_version: mod_build.to_owned(),
                            data_pack: *data_pack,
                        }),
                        MinecraftServerModification::Quilt => Some(MinecraftServerExtra::Quilt {
                            java,
                            minecraft_version: minecraft_version.clone(),
                            loader_version: mod_build.to_owned(),
                            data_pack: *data_pack,
                        }),
                        _ => None,
                    })
                }
            }
        }
    }

    async fn enabled_features(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        let mut features = HashSet::new();
        let modification = extra.modification();

        features.insert("minecraft_monitor");
        features.insert("minecraft_commands");
        if extra.supports_datapacks() {
            features.insert("minecraft_data_packs");
        }
        if modification.is_paper() {
            features.insert("minecraft_plugins_paper");
        }
        if modification.is_fabric() {
            features.insert("minecraft_mods_fabric");
        }
        if modification.is_forge() {
            features.insert("minecraft_mods_forge");
        }
        if modification.is_neoforge() {
            features.insert("minecraft_mods_neoforge");
        }
        Ok(features)
    }

    async fn primary_port(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
        ports: &HashMap<u32, ServerPort>,
    ) -> Option<(u32, ServerPort, u16)> {
        self.primary_port0(ports, 25565, NetworkProtocol::Tcp).await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    fn supports_custom_startup(&self) -> bool {
        true
    }

    fn licenses(&self) -> &'static [&'static License] {
        &[&MINECRAFT_EULA]
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        resolve_cache().await
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        Utc::now() > (Utc.timestamp_millis_opt(cache.1).unwrap() + TimeDelta::days(7))
    }
}

#[derive(Readable, Writable)]
pub(crate) struct VersionCache(
    HashMap<
        String,
        (
            usize,
            u8,
            bool,
            HashMap<MinecraftServerModification, VersionBuild>,
        ),
    >,
    i64,
);

#[derive(Readable, Writable, Clone)]
pub(crate) enum VersionBuild {
    Range(Option<String>, u16, u16, HashSet<u16>),
    Set(Vec<String>),
}

#[derive(Deserialize)]
pub(crate) struct MinecraftVersionManifestV2 {
    pub(crate) versions: Vec<MinecraftVersionEntry>,
}

#[derive(Deserialize, PartialEq, Eq)]
pub(crate) enum MinecraftVersionType {
    #[serde(rename = "release")]
    Release,
    #[serde(rename = "snapshot")]
    Snapshot,
    #[serde(rename = "old_beta")]
    Beta,
    #[serde(rename = "old_alpha")]
    Alpha,
}

#[derive(Deserialize)]
pub(crate) struct MinecraftVersionEntry {
    pub(crate) id: String,
    pub(crate) r#type: MinecraftVersionType,
}

pub(crate) async fn resolve_cache() -> Result<VersionCache, ()> {
    let client = reqwest::Client::builder()
        .build()
        .inspect_err(|err| error!("Unable to build cache update client (for minecraft): {err:?}"))
        .map_err(|_err| ())?;

    let mut cache = VersionCache(HashMap::new(), Utc::now().timestamp_millis());
    let manifest: MinecraftVersionManifestV2 = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .inspect_err(|err| error!("Unable to send minecraft manifest v2 request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get minecraft manifest v2: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive minecraft manifest v2 response: {err:?}"))
        .map_err(|_err| ())?;
    let mut recommended_java = 25;
    let mut data_pack = true;
    for (index, ver) in manifest.versions.into_iter().enumerate() {
        if MinecraftVersionType::Release == ver.r#type {
            match ver.id.as_str() {
                "1.21.11" => recommended_java = 21,
                "1.20.4" => recommended_java = 17,
                "1.16.5" => recommended_java = 8,
                "1.12.2" => data_pack = false,
                _ => {}
            }

            let end = ver.id.eq("1.7.10");
            cache
                .0
                .insert(ver.id, (index, recommended_java, data_pack, HashMap::new()));
            if end {
                break;
            }
        }
    }
    for modification in &MODS {
        match modification.backend() {
            MinecraftDownloadBackend::Vanilla => {}
            MinecraftDownloadBackend::Paper(project_name, url) => {
                paper::resolve(&client, modification, &mut cache, url, project_name).await?;
            }
            MinecraftDownloadBackend::Purpur(project_name, url) => {
                purpur::resolve(&client, modification, &mut cache, url, project_name).await?;
            }
            MinecraftDownloadBackend::Fabric(url) => {
                fabric::resolve(&client, modification, &mut cache, url).await?;
            }
            MinecraftDownloadBackend::Forge(url) => {
                forge::resolve(&client, modification, &mut cache, url).await?;
            }
            MinecraftDownloadBackend::NeoForge(url) => {
                neoforge::resolve(&client, modification, &mut cache, url).await?;
            }
        }
    }
    Ok(cache)
}
