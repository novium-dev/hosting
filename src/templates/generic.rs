mod docker;
pub mod go;
pub mod java;
pub mod python;
pub mod rust;

use core::cmp::Ordering;
use lazy_regex::lazy_regex;
use regex::Regex;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use tracing::debug;
use url::{ParseError, Url};

#[expect(clippy::non_std_lazy_statics, reason = "external crate")]
pub static BRANCH_REGEX: lazy_regex::Lazy<Regex> = lazy_regex!(r"[A-Za-z0-9\\._/-]+");

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
