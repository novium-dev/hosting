use reqwest::Client;
use std::collections::{HashMap, HashSet};
use tracing::error;

use crate::templates::games::minecraft::{
    MinecraftServerModification, VersionBuild, VersionCache, maven::MavenMetadata,
};

fn split_version(raw: &str) -> Option<(&str, &str)> {
    let (minecraft_version, rest) = raw.split_once('-')?;
    let loader_version = match rest.split_once('-') {
        Some((loader_version, suffix)) => {
            let version_like = suffix.starts_with("1.")
                && suffix.chars().all(|ch| ch.is_ascii_digit() || ch == '.');
            if !version_like {
                return None;
            }
            loader_version
        }
        None => rest,
    };
    let numeric = !loader_version.is_empty()
        && loader_version
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()));
    numeric.then_some((minecraft_version, loader_version))
}

fn version_key(version: &str) -> Vec<u32> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or_default())
        .collect()
}

pub(crate) async fn resolve(
    client: &Client,
    modification: &MinecraftServerModification,
    cache: &mut VersionCache,
    url: &str,
) -> Result<(), ()> {
    let response = client
        .get(format!("{url}/net/minecraftforge/forge/maven-metadata.xml"))
        .send()
        .await
        .inspect_err(|err| {
            error!("Unable to send maven {url:?} metadata (forge) request: {err:?}");
        })
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get maven {url:?} metadata (forge): {err:?}"))
        .map_err(|_err| ())?
        .text()
        .await
        .inspect_err(|err| {
            error!("Unable to receive maven {url:?} metadata (forge) response: {err:?}");
        })
        .map_err(|_err| ())?;

    let metadata: MavenMetadata = serde_xml_rs::from_str(&response)
        .inspect_err(|err| {
            error!("Unable to parse maven {url:?} metadata (forge) response: {err:?}");
        })
        .map_err(|_err| ())?;
    let mut versions_map: HashMap<String, HashSet<String>> = HashMap::new();
    for raw in &metadata.versioning.versions.version {
        let Some((minecraft_version, loader_version)) = split_version(raw) else {
            continue;
        };
        versions_map
            .entry(minecraft_version.to_owned())
            .or_default()
            .insert(loader_version.to_owned());
    }

    for (minecraft_version, loader_versions) in versions_map {
        let Some(cache_entry) = cache.0.get_mut(&minecraft_version) else {
            continue;
        };
        let mut loader_versions: Vec<String> = loader_versions.into_iter().collect();
        loader_versions.sort_by_cached_key(|version| core::cmp::Reverse(version_key(version)));
        cache_entry
            .3
            .insert(*modification, VersionBuild::Set(loader_versions));
    }

    Ok(())
}
