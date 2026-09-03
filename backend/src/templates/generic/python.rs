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
use crate::templates::{
    STARTUP_COMMAND_ENVIRONMENT, Template, TemplateError, TemplatePortDefinition, ThinTemplateError,
};

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct PythonExtra {
    python_version: String,
    start_file: String,
    repository_url: RepositoryURL,
    repository_branch: String,
    #[serde(default)]
    repository_username: String,
    #[serde(default)]
    repository_password: String,
}

#[derive(Readable, Writable)]
pub(crate) struct PythonVersionCache(IndexSet<(u16, u16, u16)>, i64);

pub(crate) struct PythonTemplate;

const DEFAULT_STARTUP_COMMAND: &str = "((test ! -f requirements.txt) || pip --cache-dir=.pip install -r requirements.txt) && python $MAIN_FILE";

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static PYTHON_FILE_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"^(?:[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*\/)*[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*\.py$");

impl Template for PythonTemplate {
    const ID: &'static str = "python";
    type Extra = PythonExtra;
    type Cache = PythonVersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let image = ServerBuildImage {
            parents: Vec::new(),
            base: None,
            dockerfile: include_str!("python/Dockerfile")
                .replace("{PYTHON_VERSION}", &extra.python_version),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(format!("python-{}-r2", extra.python_version)),
        };
        Ok(ServerBuildPayload {
            image,
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude: HashSet::from([
                ".git/".to_owned(),
                "__pycache__/".to_owned(),
                ".pip/".to_owned(),
                "site-packages/".to_owned(),
            ]),
            environment: git_environment(GitFields {
                url: extra.repository_url,
                branch: extra.repository_branch,
                username: extra.repository_username,
                password: extra.repository_password,
            })
            .into_iter()
            .chain([
                ("MAIN_FILE".to_owned(), extra.start_file),
                (
                    STARTUP_COMMAND_ENVIRONMENT.to_owned(),
                    DEFAULT_STARTUP_COMMAND.to_owned(),
                ),
            ])
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

        Ok(PythonExtra {
            python_version: format!("{major}.{minor}.{patch}"),
            start_file: "main.py".to_owned(),
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
                VariableGroupBuilder::new(Some("Python"))
                    .static_variable(
                        "version",
                        "Version",
                        Some(extra.python_version),
                        cache
                            .0
                            .iter()
                            .map(|(major, minor, patch)| format!("{major}.{minor}.{patch}"))
                            .collect(),
                    )
                    .regex_variable(
                        "start_file",
                        "Start File",
                        Some(extra.start_file),
                        PYTHON_FILE_REGEX.as_str(),
                        "main.py",
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

        let Some(start_file_raw) = variables.get("start_file") else {
            debug!("Variables rejected: start_file missing");
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

        if !PYTHON_FILE_REGEX.is_match(start_file_raw) {
            debug!("Variables rejected: start_file is invalid");
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

        Ok(Some(PythonExtra {
            python_version: format!("{major}.{minor}.{patch}"),
            start_file: start_file_raw.clone(),
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
        let mut versions: IndexSet<_> = docker::list_docker_tags("python")
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
            .filter(|(major, minor, _patch)| *major >= 3 && (*major != 3 || *minor >= 3))
            .collect();
        versions.sort_by(|(major_a, minor_a, patch_a), (major_b, minor_b, patch_b)| {
            version_cmp(
                &[*major_a, *minor_a, *patch_a],
                &[*major_b, *minor_b, *patch_b],
            )
        });
        Ok(PythonVersionCache(versions, timestamp))
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        let Some(last_update) = Utc.timestamp_millis_opt(cache.1).single() else {
            return docker::update();
        };

        Utc::now() > (last_update + TimeDelta::days(1)) && docker::update()
    }
}
