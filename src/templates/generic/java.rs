use chrono::{TimeDelta, TimeZone, Utc};
use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use indexmap::{IndexMap, IndexSet};
use lazy_regex::regex_captures;
use redis::RedisError;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt::{Display, Formatter};
use tracing::debug;

use crate::templates::generic::{BRANCH_REGEX, RepositoryURL, docker, version_cmp};
use crate::templates::variable::{
    VariableBuilder, VariableContent, VariableDataBuilder, VariableGroupBuilder, VariablePayload,
};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct JavaExtra {
    java_version: JavaVersion,
    build: JavaBuild,
    repository_url: RepositoryURL,
    repository_branch: String,
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
            default_tag: Some(format!("java-{}-r1", extra.java_version)),
        };
        let image = ServerBuildImage {
            parents: vec![generic],
            base: Some(0),
            dockerfile: match extra.build {
                JavaBuild::Prebuilt => include_str!("java/prebuild.Dockerfile"),
                JavaBuild::Gradle => include_str!("java/gradle.Dockerfile"),
            }
            .to_string(),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(match extra.build {
                JavaBuild::Prebuilt => format!("java-prebuilt-{}-r1", extra.java_version),
                JavaBuild::Gradle => format!("java-gradle-{}-r1", extra.java_version),
            }),
        };
        let mut backup_exclude = HashSet::from([".git/".to_string()]);
        if let JavaBuild::Gradle = extra.build {
            backup_exclude.extend([".gradle/".to_string(), "build/".to_string()]);
        }
        Ok(ServerBuildPayload {
            image,
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude,
            environment: HashMap::from([
                ("REPOSITORY_URL".to_string(), extra.repository_url.into()),
                ("REPOSITORY_BRANCH".to_string(), extra.repository_branch),
            ]),
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
            repository_branch: "HEAD".to_string(),
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
            .data(VariableDataBuilder::new(cache.0.keys().copied().collect()).layer::<1, _, _>(
                |major| {
                    let content = cache
                        .0
                        .get(major)
                        .into_iter()
                        .flat_map(|versions| versions.iter())
                        .map(JavaVersion::to_string)
                        .collect();
                    vec![(
                        format!("Java {}", major),
                        VariableContent::StringSet { content },
                    )]
                },
            ))
            .group(
                VariableGroupBuilder::new(Some("Git"))
                    .regex_variable("repository_url", "Repository URL", Some(extra.repository_url), "^https?:\\/\\/(?:www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)$", "https://gitlab.com/example_user/example_repo.git", false)
                    .regex_variable("repository_branch", "Repository Branch", Some(extra.repository_branch), BRANCH_REGEX.as_str(), "HEAD", false),
            )
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

        let Some(repository_url_raw) = variables.get("repository_url") else {
            debug!("Variables rejected: repository_url missing");
            return Ok(None);
        };

        let Some(repository_branch_raw) = variables.get("repository_branch") else {
            debug!("Variables rejected: repository_branch missing");
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
        if !BRANCH_REGEX.is_match(repository_branch_raw) {
            debug!("Variables rejected: repository_branch is invalid");
            return Ok(None);
        }

        let repository_url = match RepositoryURL::parse(repository_url_raw) {
            Ok(url) => url,
            Err(_) => {
                debug!("Variables rejected: repository_url is invalid");
                return Ok(None);
            }
        };

        Ok(Some(JavaExtra {
            java_version: version,
            build,
            repository_url,
            repository_branch: repository_branch_raw.clone(),
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
        Utc::now() > (Utc.timestamp_millis_opt(cache.1).unwrap() + TimeDelta::days(1))
            && docker::update()
    }
}

impl JavaVersion {
    fn as_array(&self) -> [u16; 4] {
        match self {
            JavaVersion::Modern {
                major,
                minor,
                patch,
                build,
            } => [*major, *minor, *patch, *build],
            JavaVersion::Legacy {
                major,
                patch,
                build,
            } => [*major, 0, *patch, *build],
        }
    }

    fn major(&self) -> u16 {
        match self {
            JavaVersion::Modern { major, .. } | JavaVersion::Legacy { major, .. } => *major,
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
            return Some(JavaVersion::Modern {
                major,
                minor: minor.parse::<u16>().ok()?,
                patch: patch.parse::<u16>().ok()?,
                build: build.parse::<u16>().ok()?,
            });
        }

        let (_, major, patch, build) = regex_captures!(r"^(8)u([0-9]+)-b([0-9]{2})$", value)?;
        Some(JavaVersion::Legacy {
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
        version_cmp(self.as_array(), other.as_array())
    }
}

impl Display for JavaVersion {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            JavaVersion::Modern {
                major,
                minor,
                patch,
                build,
            } => write!(f, "{}.{}.{}_{}", major, minor, patch, build),
            JavaVersion::Legacy {
                major,
                patch,
                build,
            } => write!(f, "{}u{}-b{:02}", major, patch, build),
        }
    }
}
