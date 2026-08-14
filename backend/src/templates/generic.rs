mod docker;
pub mod go;
pub mod java;
pub mod javascript;
pub mod python;
pub mod rust;

use crate::templates::variable::VariableGroupBuilder;
use core::cmp::Ordering;
use lazy_regex::lazy_regex;
use regex::Regex;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use tracing::debug;
use url::{ParseError, Url};

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static BRANCH_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"[A-Za-z0-9\\._/-]+");

pub(crate) const REPOSITORY_URL_REGEX: &str = r"^$|^https?://(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)$";

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static GIT_CREDENTIAL_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"^[^\r\n]*$");

pub(crate) struct GitFields {
    pub url: RepositoryURL,
    pub branch: String,
    pub username: String,
    pub password: String,
}

pub(crate) fn git_variable_group(git: GitFields) -> VariableGroupBuilder {
    VariableGroupBuilder::new(Some("Git"))
        .regex_variable(
            "repository_url",
            "Repository URL",
            Some(git.url),
            REPOSITORY_URL_REGEX,
            "https://gitlab.com/example_user/example_repo.git",
            false,
        )
        .regex_variable(
            "repository_branch",
            "Repository Branch",
            Some(git.branch),
            BRANCH_REGEX.as_str(),
            "HEAD",
            false,
        )
        .regex_variable(
            "repository_username",
            "Git Username",
            Some(git.username),
            GIT_CREDENTIAL_REGEX.as_str(),
            "oauth2",
            false,
        )
        .regex_variable(
            "repository_password",
            "Git Password / Token",
            Some(git.password),
            GIT_CREDENTIAL_REGEX.as_str(),
            "",
            true,
        )
}

pub(crate) fn git_environment(git: GitFields) -> [(String, String); 4] {
    [
        ("REPOSITORY_URL".to_owned(), git.url.into()),
        ("REPOSITORY_BRANCH".to_owned(), git.branch),
        ("REPOSITORY_USERNAME".to_owned(), git.username),
        ("REPOSITORY_PASSWORD".to_owned(), git.password),
    ]
}

pub(crate) fn parse_git_fields(variables: &HashMap<String, String>) -> Option<GitFields> {
    let repository_url_raw = variables.get("repository_url")?;
    let repository_branch_raw = variables.get("repository_branch")?;
    let username = variables
        .get("repository_username")
        .cloned()
        .unwrap_or_default();
    let password = variables
        .get("repository_password")
        .cloned()
        .unwrap_or_default();

    if !BRANCH_REGEX.is_match(repository_branch_raw) {
        debug!("Variables rejected: repository_branch is invalid");
        return None;
    }
    if !GIT_CREDENTIAL_REGEX.is_match(&username) || !GIT_CREDENTIAL_REGEX.is_match(&password) {
        debug!("Variables rejected: git credentials are invalid");
        return None;
    }

    let Ok(url) = RepositoryURL::parse(repository_url_raw) else {
        debug!("Variables rejected: repository_url is invalid");
        return None;
    };

    Some(GitFields {
        url,
        branch: repository_branch_raw.clone(),
        username,
        password,
    })
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) enum RepositoryURL {
    Disabled,
    Url(Url),
}

impl RepositoryURL {
    pub fn parse(repository_url_raw: &str) -> Result<Self, ParseError> {
        if repository_url_raw.is_empty() {
            return Ok(Self::Disabled);
        }

        let repository_url = Url::parse(repository_url_raw)
            .inspect_err(|_err| debug!("Variables rejected: invalid repository URL"))?;

        Ok(Self::Url(repository_url))
    }
}

impl From<RepositoryURL> for String {
    fn from(value: RepositoryURL) -> Self {
        match value {
            RepositoryURL::Disabled => Self::new(),
            RepositoryURL::Url(url) => url.into(),
        }
    }
}

impl<'de> Deserialize<'de> for RepositoryURL {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let str = String::deserialize(deserializer)?;
        if str.is_empty() {
            Ok(Self::Disabled)
        } else {
            Ok(Self::Url(
                Url::parse(&str).map_err(|err| D::Error::custom(err.to_string()))?,
            ))
        }
    }
}

impl Serialize for RepositoryURL {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Disabled => serializer.serialize_str(""),
            Self::Url(url) => url.serialize(serializer),
        }
    }
}

pub(crate) fn version_cmp<const N: usize, T: Ord>(left: &[T; N], right: &[T; N]) -> Ordering {
    left.iter()
        .zip(right)
        .find_map(|(left, right)| match left.cmp(right) {
            Ordering::Less => Some(Ordering::Greater),
            Ordering::Equal => None,
            Ordering::Greater => Some(Ordering::Less),
        })
        .unwrap_or(Ordering::Equal)
}
