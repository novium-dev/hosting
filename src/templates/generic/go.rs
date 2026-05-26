use chrono::{TimeDelta, TimeZone, Utc};
use indexmap::IndexSet;
use regex::Regex;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use lazy_regex::lazy_regex;
use redis::aio::ConnectionManager;
use redis::RedisError;
use tracing::debug;
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};
use crate::templates::generic::{docker, version_cmp, RepositoryURL, BRANCH_REGEX};
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct GoExtra {
    go_version: String,
    build_file: String,
    repository_url: RepositoryURL,
    repository_branch: String,
}

#[derive(Readable, Writable)]
pub(crate) struct GoVersionCache(IndexSet<(u16, u16, u16)>, i64);

pub(crate) struct GoTemplate;

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static GO_FILE_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"^(?:[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*\/)*[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*\.go$");

impl Template for GoTemplate {
    const ID: &'static str = "go";
    type Extra = GoExtra;
    type Cache = GoVersionCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        let image = ServerBuildImage {
            parents: Vec::new(),
            base: None,
            dockerfile: include_str!("go/Dockerfile").replace("{GO_VERSION}", &extra.go_version),
            args: HashMap::new(),
            tag: None,
            default_tag: Some(format!("go-{}-r1", extra.go_version)),
        };
        Ok(ServerBuildPayload {
            image,
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude: HashSet::from([".git/".to_string(), ".gocache/".to_string()]),
            environment: HashMap::from([
                ("REPOSITORY_URL".to_string(), extra.repository_url.into()),
                ("REPOSITORY_BRANCH".to_string(), extra.repository_branch),
                ("GO_FILE".to_string(), extra.build_file),
            ]),
            files_write: HashMap::new(),
            cap_add: Vec::new(),
            cap_drop: Vec::new(),
        })
    }

    async fn default_extra(&self, cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        Ok(GoExtra {
            go_version: format!("{}.{}.{}", cache.0[0].0, cache.0[0].1, cache.0[0].2),
            build_file: "main.go".to_string(),
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
                VariableGroupBuilder::new(Some("Go"))
                    .static_variable("version", "Version", Some(extra.go_version), cache.0.iter().map(|(major, minor, patch)| format!("{}.{}.{}", major, minor, patch)).collect())
                    .regex_variable("build_file", "Build File", Some(extra.build_file), GO_FILE_REGEX.as_str(), "main.go", false),
            )
            .group(VariableGroupBuilder::new(Some("Git"))
                       .regex_variable("repository_url", "Repository URL", Some(extra.repository_url), "^https?:\\/\\/(?:www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)$", "https://gitlab.com/example_user/example_repo.git", false)
                       .regex_variable("repository_branch", "Repository Branch", Some(extra.repository_branch), BRANCH_REGEX.as_str(), "HEAD", false),
            )
            .into_payload()
        )
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

        let Some(build_file_raw) = variables.get("build_file") else {
            debug!("Variables rejected: build_file missing");
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

        let version_split = version_raw
            .splitn(3, ".")
            .map(String::from)
            .collect::<Vec<String>>();
        if version_split.len() != 3 {
            debug!("Variables rejected: version not found");
            return Ok(None);
        }

        if !GO_FILE_REGEX.is_match(build_file_raw) {
            debug!("Variables rejected: build_file is invalid");
            return Ok(None);
        }

        let (major_raw, minor_raw, patch_raw) = (
            version_split[0].parse::<u16>(),
            version_split[1].parse::<u16>(),
            version_split[2].parse::<u16>(),
        );

        let (major, minor, patch) = match (major_raw, minor_raw, patch_raw) {
            (Ok(major), Ok(minor), Ok(patch)) => (major, minor, patch),
            _ => {
                debug!("Variables rejected: version not found");
                return Ok(None);
            }
        };

        if !cache.0.contains(&(major, minor, patch)) {
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

        Ok(Some(GoExtra {
            go_version: format!("{}.{}.{}", major, minor, patch),
            build_file: build_file_raw.clone(),
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
        let mut versions: IndexSet<_> = docker::list_docker_tags("golang")
            .await?
            .into_iter()
            .map(|t| t.splitn(3, ".").map(String::from).collect::<Vec<String>>())
            .filter(|s| s.len() == 3)
            .map(|s| {
                (
                    s[0].parse::<u16>(),
                    s[1].parse::<u16>(),
                    s[2].parse::<u16>(),
                )
            })
            .filter(|(major, minor, patch)| major.is_ok() && minor.is_ok() && patch.is_ok())
            .map(|(major, minor, patch)| (major.unwrap(), minor.unwrap(), patch.unwrap()))
            .collect();
        versions.sort_by(|(major_a, minor_a, patch_a), (major_b, minor_b, patch_b)| {
            version_cmp(
                [*major_a, *minor_a, *patch_a],
                [*major_b, *minor_b, *patch_b],
            )
        });
        Ok(GoVersionCache(versions, timestamp))
    }

    fn cache_update_needed(cache: &Self::Cache) -> bool {
        Utc::now() > (Utc.timestamp_millis_opt(cache.1).unwrap() + TimeDelta::days(1))
            && docker::update()
    }
}