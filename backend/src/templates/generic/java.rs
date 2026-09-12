use chrono::{TimeDelta, TimeZone as _, Utc};
use core::cmp::Ordering;
use core::fmt::{Display, Formatter, Result as FmtResult};
use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use indexmap::{IndexMap, IndexSet};
use lazy_regex::regex_captures;
use redis::RedisError;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::debug;

use crate::templates::generic::{
    GitFields, RepositoryURL, docker, git_environment, git_variable_group, parse_git_fields,
    version_cmp,
};
use crate::templates::variable::{
    VariableBuilder, VariableContent, VariableDataBuilder, VariableGroupBuilder, VariablePayload,
};
use crate::templates::{
    STARTUP_COMMAND_ENVIRONMENT, Template, TemplateError, TemplatePortDefinition, ThinTemplateError,
};

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct JavaExtra {
    java_version: JavaVersion,
    build: JavaBuild,
    repository_url: RepositoryURL,
    repository_branch: String,
    #[serde(default)]
    repository_username: String,
    #[serde(default)]
    repository_password: String,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) enum JavaBuild {
    #[serde(rename = "prebuilt")]
    Prebuilt,
    #[serde(rename = "gradle")]
    Gradle,
}

#[derive(Readable, Writable)]
pub(crate) struct JavaVersionCache(IndexMap<u16, IndexSet<JavaVersion>>, i64);

#[derive(Readable, Writable, Hash, PartialEq, Eq, Copy, Clone, Serialize, Deserialize, Debug)]
#[serde(untagged)]
enum JavaVersion {
    Modern {
        major: u16,
        minor: u16,
        patch: u16,
        build: u16,
    },
    Legacy {
        major: u16,
        patch: u16,
        build: u16,
    },
}

pub(crate) struct JavaTemplate;

const PREBUILT_STARTUP_COMMAND: &str =
    "java -Djava.net.preferIPv6Addresses=system -XX:MaxRAMPercentage=95.0 -jar server.jar";
const GRADLE_STARTUP_COMMAND: &str = "/bin/sh ./gradlew run";

impl JavaBuild {
    const fn default_startup_command(self) -> &'static str {
        match self {
            Self::Prebuilt => PREBUILT_STARTUP_COMMAND,
            Self::Gradle => GRADLE_STARTUP_COMMAND,
        }
    }
}

impl Template for JavaTemplate {
    const ID: &'static str = "java";
    type Extra = JavaExtra;
    type Cache = JavaVersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let generic = ServerBuildImage {
            parents: Vec::new(),
            base: None,
            dockerfile: include_str!("java/generic.Dockerfile")
                .replace("{JAVA_VERSION}", &extra.java_version.to_string()),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(format!("java-{}-r2", extra.java_version)),
        };
        let image = ServerBuildImage {
            parents: vec![generic],
            base: Some(0),
            dockerfile: match extra.build {
                JavaBuild::Prebuilt => include_str!("java/prebuild.Dockerfile"),
                JavaBuild::Gradle => include_str!("java/gradle.Dockerfile"),
            }
            .to_owned(),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(match extra.build {
                JavaBuild::Prebuilt => format!("java-prebuilt-{}-r4", extra.java_version),
                JavaBuild::Gradle => format!("java-gradle-{}-r4", extra.java_version),
            }),
        };
        let mut backup_exclude = HashSet::from([".git/".to_owned()]);
        if extra.build == JavaBuild::Gradle {
            backup_exclude.extend([".gradle/".to_owned(), "build/".to_owned()]);
        }
        Ok(ServerBuildPayload {
            image,
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude,
            environment: git_environment(GitFields {
                url: extra.repository_url,
                branch: extra.repository_branch,
                username: extra.repository_username,
                password: extra.repository_password,
            })
            .into_iter()
            .chain([(
                STARTUP_COMMAND_ENVIRONMENT.to_owned(),
                extra.build.default_startup_command().to_owned(),
            )])
            .collect(),
            files_write: HashMap::new(),
            cap_add: Vec::new(),
            cap_drop: Vec::new(),
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let java_version = cache
            .0
            .first()
            .and_then(|(_major, versions)| versions.first().copied())
            .ok_or(ThinTemplateError::Unavailable)?;
        Ok(JavaExtra {
            java_version,
            build: JavaBuild::Prebuilt,
            repository_url: RepositoryURL::Disabled,
            repository_branch: "HEAD".to_owned(),
            repository_username: String::new(),
            repository_password: String::new(),
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::new())
    }

    async fn extra_to_variables(
        &self,
        cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<VariablePayload, TemplateError> {
        Ok(VariableBuilder::default()
            .group(
                VariableGroupBuilder::new(Some("Java"))
                    .hierarchy_variable(
                        "major_version",
                        "Major Version",
                        Some(format!("Java {}", extra.java_version.major())),
                        0,
                        0,
                    )
                    .hierarchy_variable(
                        "minor_version",
                        "Version",
                        Some(extra.java_version.to_string()),
                        1,
                        0,
                    )
                    .static_variable(
                        "build",
                        "Build",
                        Some(match extra.build {
                            JavaBuild::Prebuilt => "prebuilt",
                            JavaBuild::Gradle => "gradle",
                        }),
                        ["prebuilt", "gradle"].into_iter().collect(),
                    ),
            )
            .data(
                VariableDataBuilder::new(cache.0.keys().copied().collect()).layer::<1, _, _>(
                    |major| {
                        let content = cache
                            .0
                            .get(major)
                            .into_iter()
                            .flat_map(|versions| versions.iter())
                            .map(JavaVersion::to_string)
                            .collect();
                        vec![(
                            format!("Java {major}"),
                            VariableContent::StringSet { content },
                        )]
                    },
                ),
            )
            .group(git_variable_group(GitFields {
                url: extra.repository_url,
                branch: extra.repository_branch,
                username: extra.repository_username,
                password: extra.repository_password,
            }))
            .into_payload())
    }

    async fn variables_to_extra_validated(
        &self,
        cache: &Self::Cache,
        _old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> Result<Option<Self::Extra>, TemplateError> {
        let Some(version_raw) = variables.get("minor_version") else {
            debug!("Variables rejected: version missing");
            return Ok(None);
        };

        let Some(build_raw) = variables.get("build") else {
            debug!("Variables rejected: build missing");
            return Ok(None);
        };

        let Some(version) = JavaVersion::parse(&format!("{version_raw}-jdk")) else {
            debug!("Variables rejected: version not found");
            return Ok(None);
        };

        let build = match build_raw.as_str() {
            "prebuilt" => JavaBuild::Prebuilt,
            "gradle" => JavaBuild::Gradle,
            _ => {
                debug!("Variables rejected: build not found");
                return Ok(None);
            }
        };

        if !cache
            .0
            .get(&version.major())
            .is_some_and(|set| set.contains(&version))
        {
            debug!("Variables rejected: version not found");
            return Ok(None);
        }

        let Some(git) = parse_git_fields(&variables) else {
            return Ok(None);
        };

        Ok(Some(JavaExtra {
            java_version: version,
            build,
            repository_url: git.url,
            repository_branch: git.branch,
            repository_username: git.username,
            repository_password: git.password,
        }))
    }

    async fn enabled_features(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        Ok(HashSet::new())
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    fn supports_custom_startup(&self) -> bool {
        true
    }

    fn supports_custom_environment(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        let timestamp = Utc::now().timestamp_millis();
        let mut versions: Vec<_> = docker::list_docker_tags("eclipse-temurin")
            .await?
            .into_iter()
            .filter_map(|tag| JavaVersion::parse(&tag))
            .collect();
        versions.sort();

        let mut versions_map: IndexMap<u16, IndexSet<JavaVersion>> = IndexMap::new();
        for version in versions {
            versions_map
                .entry(version.major())
                .or_default()
                .insert(version);
        }

        Ok(JavaVersionCache(versions_map, timestamp))
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        let Some(last_update) = Utc.timestamp_millis_opt(cache.1).single() else {
            return docker::update();
        };

        Utc::now() > (last_update + TimeDelta::days(1)) && docker::update()
    }
}

impl JavaVersion {
    const fn as_array(&self) -> [u16; 4] {
        match self {
            Self::Modern {
                major,
                minor,
                patch,
                build,
            } => [*major, *minor, *patch, *build],
            Self::Legacy {
                major,
                patch,
                build,
            } => [*major, 0, *patch, *build],
        }
    }

    const fn major(&self) -> u16 {
        match self {
            Self::Modern { major, .. } | Self::Legacy { major, .. } => *major,
        }
    }

    fn parse(value: &str) -> Option<Self> {
        if let Some((_, major, minor, patch, build)) =
            regex_captures!(r"^([0-9]+)\.([0-9]+)\.([0-9]+)_([0-9]+)-jdk$", value)
        {
            let major = major.parse::<u16>().ok()?;
            if major == 0 {
                return None;
            }
            return Some(Self::Modern {
                major,
                minor: minor.parse::<u16>().ok()?,
                patch: patch.parse::<u16>().ok()?,
                build: build.parse::<u16>().ok()?,
            });
        }

        let (_, major, patch, build) = regex_captures!(r"^(8)u([0-9]+)-b([0-9]{2})$", value)?;
        Some(Self::Legacy {
            major: major.parse::<u16>().ok()?,
            patch: patch.parse::<u16>().ok()?,
            build: build.parse::<u16>().ok()?,
        })
    }
}

impl PartialOrd for JavaVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for JavaVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        version_cmp(&self.as_array(), &other.as_array())
    }
}

impl Display for JavaVersion {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        match self {
            Self::Modern {
                major,
                minor,
                patch,
                build,
            } => write!(f, "{major}.{minor}.{patch}_{build}"),
            Self::Legacy {
                major,
                patch,
                build,
            } => write!(f, "{major}u{patch}-b{build:02}"),
        }
    }
}
