use chrono::{TimeDelta, TimeZone as _, Utc};
use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use indexmap::IndexSet;
use redis::RedisError;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::debug;

use crate::templates::generic::{BRANCH_REGEX, RepositoryURL, docker, version_cmp};
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct RustExtra {
    rust_version: String,
    repository_url: RepositoryURL,
    repository_branch: String,
}

#[derive(Readable, Writable)]
pub(crate) struct RustVersionCache(IndexSet<(u16, u16, u16)>, i64);

pub(crate) struct RustTemplate;

impl Template for RustTemplate {
    const ID: &'static str = "rust";
    type Extra = RustExtra;
    type Cache = RustVersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let image = ServerBuildImage {
            parents: Vec::new(),
            base: None,
            dockerfile: include_str!("rust/Dockerfile")
                .replace("{RUST_VERSION}", &extra.rust_version),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(format!("rust-{}-r1", extra.rust_version)),
        };
        Ok(ServerBuildPayload {
            image,
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude: HashSet::from([".git/".to_owned(), "target/".to_owned()]),
            environment: HashMap::from([
                ("REPOSITORY_URL".to_owned(), extra.repository_url.into()),
                ("REPOSITORY_BRANCH".to_owned(), extra.repository_branch),
            ]),
            files_write: HashMap::new(),
            cap_add: Vec::new(),
            cap_drop: Vec::new(),
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        let Some((major, minor, patch)) = cache.0.first() else {
            return Err(ThinTemplateError::Unavailable);
        };

        Ok(RustExtra {
            rust_version: format!("{major}.{minor}.{patch}"),
            repository_url: RepositoryURL::Disabled,
            repository_branch: "HEAD".to_owned(),
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
                VariableGroupBuilder::new(Some("Rust")).static_variable(
                    "version",
                    "Version",
                    Some(extra.rust_version),
                    cache
                        .0
                        .iter()
                        .map(|(major, minor, patch)| format!("{major}.{minor}.{patch}"))
                        .collect(),
                ),
            )
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
        let Some(version_raw) = variables.get("version") else {
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
        if !BRANCH_REGEX.is_match(repository_branch_raw) {
            debug!("Variables rejected: repository_branch is invalid");
            return Ok(None);
        }

        let Ok(repository_url) = RepositoryURL::parse(repository_url_raw) else {
            debug!("Variables rejected: repository_url is invalid");
            return Ok(None);
        };

        Ok(Some(RustExtra {
            rust_version: format!("{major}.{minor}.{patch}"),
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
        let mut versions: IndexSet<_> = docker::list_docker_tags("rust")
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
            .collect();
        versions.sort_by(|(major_a, minor_a, patch_a), (major_b, minor_b, patch_b)| {
            version_cmp(
                &[*major_a, *minor_a, *patch_a],
                &[*major_b, *minor_b, *patch_b],
            )
        });
        Ok(RustVersionCache(versions, timestamp))
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        let Some(last_update) = Utc.timestamp_millis_opt(cache.1).single() else {
            return docker::update();
        };

        Utc::now() > (last_update + TimeDelta::days(1)) && docker::update()
    }
}
