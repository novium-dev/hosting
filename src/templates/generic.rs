pub mod go;
mod docker;

use serde::de::Error;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::cmp::Ordering;
use lazy_regex::lazy_regex;
use regex::Regex;
use tracing::debug;
use url::{ParseError, Url};

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static BRANCH_REGEX: lazy_regex::Lazy<Regex> =
    lazy_regex!(r"[A-Za-z0-9\\._/-]+");

#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) enum RepositoryURL {
    Disabled,
    Url(Url),
}

impl RepositoryURL {
    pub fn parse(
        repository_url_raw: &str,
    ) -> Result<Self, ParseError> {
        if repository_url_raw.is_empty() {
            return Ok(RepositoryURL::Disabled);
        }

        let repository_url = Url::parse(repository_url_raw)
            .inspect_err(|_err| debug!("Variables rejected: invalid repository URL"))?;

        Ok(RepositoryURL::Url(repository_url))
    }
}

impl From<RepositoryURL> for String {
    fn from(value: RepositoryURL) -> Self {
        match value {
            RepositoryURL::Disabled => String::new(),
            RepositoryURL::Url(url) => url.to_string(),
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
            Ok(RepositoryURL::Disabled)
        } else {
            Ok(RepositoryURL::Url(
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
            RepositoryURL::Disabled => serializer.serialize_str(""),
            RepositoryURL::Url(url) => url.serialize(serializer),
        }
    }
}

pub(crate) fn version_cmp<const N: usize, T: Ord>(a: [T; N], b: [T; N]) -> Ordering {
    let mut current = Ordering::Equal;
    for i in 0..N {
        match a[i].cmp(&b[i]) {
            Ordering::Less => {
                current = Ordering::Greater;
                break;
            }
            Ordering::Equal => continue,
            Ordering::Greater => {
                current = Ordering::Less;
                break;
            }
        }
    }
    current
}