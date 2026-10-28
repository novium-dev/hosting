use chrono::{TimeDelta, TimeZone as _, Utc};
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

use crate::templates::generic::{
    GitFields, RepositoryURL, docker, git_environment, git_variable_group, parse_git_fields,
    version_cmp,
};
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const REL: u32 = 5;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) enum PackageManager {
    #[serde(rename = "npm")]
    Npm,
    #[serde(rename = "pnpm")]
    Pnpm,
    #[serde(rename = "bun")]
    Bun,
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct JavascriptExtra {
    node_version: String,
    package_manager: PackageManager,
    start_script: String,
    repository_url: RepositoryURL,
    repository_branch: String,
    #[serde(default)]
    repository_username: String,
    #[serde(default)]
    repository_password: String,
}

#[derive(Readable, Writable)]
pub(crate) struct JavascriptVersionCache(IndexSet<(u16, u16, u16)>, i64);

pub(crate) struct JavascriptTemplate;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static START_SCRIPT_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"^[a-zA-Z][a-zA-Z0-9]*(?:[:_-][a-zA-Z0-9]+)*$");

impl Template for JavascriptTemplate {
    const ID: &'static str = "javascript";
    const REL: u32 = REL;
    type Extra = JavascriptExtra;
    type Cache = JavascriptVersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let generic = ServerBuildImage {
            parents: Vec::new(),
            base: None,
            dockerfile: include_str!("javascript/generic.Dockerfile")
                .replace("{NODE_VERSION}", &extra.node_version),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(format!("javascript-{}-r2", extra.node_version)),
        };
        let image = ServerBuildImage {
            parents: vec![generic],
            base: Some(0),
            dockerfile: match extra.package_manager {
                PackageManager::Npm => include_str!("javascript/npm.Dockerfile"),
                PackageManager::Pnpm => include_str!("javascript/pnpm.Dockerfile"),
                PackageManager::Bun => include_str!("javascript/bun.Dockerfile"),
            }
            .to_owned(),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(match extra.package_manager {
                PackageManager::Npm => format!("javascript-npm-{}-r{REL}", extra.node_version),
                PackageManager::Pnpm => format!("javascript-pnpm-{}-r{REL}", extra.node_version),
                PackageManager::Bun => format!("javascript-bun-{}-r{REL}", extra.node_version),
            }),
        };
        Ok(ServerBuildPayload {
            image,
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude: HashSet::from([".git/".to_owned(), "node_modules/".to_owned()]),
            environment: git_environment(GitFields {
                url: extra.repository_url,
                branch: extra.repository_branch,
                username: extra.repository_username,
                password: extra.repository_password,
            })
            .into_iter()
            .chain([("START_SCRIPT".to_owned(), extra.start_script)])
            .collect(),
            files_write: HashMap::new(),
            cap_add: Vec::new(),
            cap_drop: Vec::new(),
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let Some((major, minor, patch)) = cache.0.first() else {
            return Err(ThinTemplateError::Unavailable);
        };

        Ok(JavascriptExtra {
            node_version: format!("{major}.{minor}.{patch}"),
            package_manager: PackageManager::Npm,
            start_script: "start".to_owned(),
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
                VariableGroupBuilder::new(Some("JavaScript"))
                    .static_variable(
                        "version",
                        "Node Version",
                        Some(extra.node_version),
                        cache
                            .0
                            .iter()
                            .map(|(major, minor, patch)| format!("{major}.{minor}.{patch}"))
                            .collect(),
                    )
                    .static_variable(
                        "package_manager",
                        "Package Manager",
                        Some(extra.package_manager.as_str()),
                        ["npm", "pnpm", "bun"].into_iter().collect(),
                    )
                    .regex_variable(
                        "start_script",
                        "Start Script",
                        Some(extra.start_script),
                        START_SCRIPT_REGEX.as_str(),
                        "start",
                        false,
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
        let Some(version_raw) = variables.get("version") else {
            debug!("Variables rejected: version missing");
            return Ok(None);
        };

        let Some(package_manager_raw) = variables.get("package_manager") else {
            debug!("Variables rejected: package_manager missing");
            return Ok(None);
        };

        let Some(start_script_raw) = variables.get("start_script") else {
            debug!("Variables rejected: start_script missing");
            return Ok(None);
        };

        let mut version_parts = version_raw.splitn(3, '.');
        let (Some(major_raw), Some(minor_raw), Some(patch_raw), None) = (
            version_parts.next(),
            version_parts.next(),
            version_parts.next(),
            version_parts.next(),
        ) else {
            debug!("Variables rejected: version not found");
            return Ok(None);
        };

        let Some(package_manager) = PackageManager::parse(package_manager_raw) else {
            debug!("Variables rejected: package_manager not found");
            return Ok(None);
        };

        if !START_SCRIPT_REGEX.is_match(start_script_raw) {
            debug!("Variables rejected: start_script is invalid");
            return Ok(None);
        }

        let (Ok(major), Ok(minor), Ok(patch)) = (
            major_raw.parse::<u16>(),
            minor_raw.parse::<u16>(),
            patch_raw.parse::<u16>(),
        ) else {
            debug!("Variables rejected: version not found");
            return Ok(None);
        };

        if !cache.0.contains(&(major, minor, patch)) {
            debug!("Variables rejected: version not found");
            return Ok(None);
        }

        let Some(git) = parse_git_fields(&variables) else {
            return Ok(None);
        };

        Ok(Some(JavascriptExtra {
            node_version: format!("{major}.{minor}.{patch}"),
            package_manager,
            start_script: start_script_raw.clone(),
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

    fn supports_custom_environment(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        let timestamp = Utc::now().timestamp_millis();
        let mut versions: IndexSet<_> = docker::list_docker_tags("node")
            .await?
            .into_iter()
            .filter_map(|tag| {
                let mut tag_parts = tag.splitn(3, '.');
                let (Some(major), Some(minor), Some(patch), None) = (
                    tag_parts.next(),
                    tag_parts.next(),
                    tag_parts.next(),
                    tag_parts.next(),
                ) else {
                    return None;
                };
                Some((
                    major.parse::<u16>().ok()?,
                    minor.parse::<u16>().ok()?,
                    patch.parse::<u16>().ok()?,
                ))
            })
            .filter(|(major, _minor, _patch)| *major >= 12)
            .collect();
        versions.sort_by(|(major_a, minor_a, patch_a), (major_b, minor_b, patch_b)| {
            version_cmp(
                &[*major_a, *minor_a, *patch_a],
                &[*major_b, *minor_b, *patch_b],
            )
        });
        Ok(JavascriptVersionCache(versions, timestamp))
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        let Some(last_update) = Utc.timestamp_millis_opt(cache.1).single() else {
            return docker::update();
        };

        Utc::now() > (last_update + TimeDelta::days(1)) && docker::update()
    }
}

impl PackageManager {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::Bun => "bun",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "npm" => Some(Self::Npm),
            "pnpm" => Some(Self::Pnpm),
            "bun" => Some(Self::Bun),
            _ => None,
        }
    }
}
