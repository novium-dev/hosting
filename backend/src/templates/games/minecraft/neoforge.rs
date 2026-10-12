use reqwest::Client;
use std::collections::{HashMap, HashSet};
use tracing::error;

use crate::templates::games::minecraft::{
    MinecraftServerModification, VersionBuild, VersionCache, maven::MavenMetadata,
};

pub(crate) async fn resolve(
    client: &Client,
    modification: &MinecraftServerModification,
    cache: &mut VersionCache,
    url: &str,
) -> Result<(), ()> {
    let response = client
        .get(format!(
            "{url}/releases/net/neoforged/neoforge/maven-metadata.xml"
        ))
        .send()
        .await
        .inspect_err(|err| {
            error!("Unable to send maven {url:?} metadata (neoforge) request: {err:?}");
        })
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get maven {url:?} metadata (neoforge): {err:?}"))
        .map_err(|_err| ())?
        .text()
        .await
        .inspect_err(|err| {
            error!("Unable to receive maven {url:?} metadata (neoforge) response: {err:?}");
        })
        .map_err(|_err| ())?;

    let metadata: MavenMetadata = serde_xml_rs::from_str(&response)
        .inspect_err(|err| {
            error!("Unable to parse maven {url:?} metadata (neoforge) response: {err:?}");
        })
        .map_err(|_err| ())?;
    let mut versions_map: HashMap<(String, String), HashSet<u16>> = HashMap::new();
    for raw in metadata.versioning.versions.version {
        let parts: Vec<&str> = raw.split('.').collect();
        let Some(Ok(first)) = parts.first().map(|part| part.parse::<u16>()) else {
            continue;
        };
        let (minecraft_version, prefix, build) = if first >= 26 {
            let [major, minor, patch, build] = parts.as_slice() else {
                continue;
            };
            let minecraft_version = if *patch == "0" {
                format!("{major}.{minor}")
            } else {
                format!("{major}.{minor}.{patch}")
            };
            (
                minecraft_version,
                format!("{major}.{minor}.{patch}."),
                *build,
            )
        } else {
            let [minor, patch, build] = parts.as_slice() else {
                continue;
            };
            let minecraft_version = if *patch == "0" {
                format!("1.{minor}")
            } else {
                format!("1.{minor}.{patch}")
            };
            (minecraft_version, format!("{minor}.{patch}."), *build)
        };
        let Ok(build) = build.parse::<u16>() else {
            continue;
        };
        versions_map
            .entry((minecraft_version, prefix))
            .or_default()
            .insert(build);
    }

    for ((minecraft_version, prefix), loader_versions) in versions_map {
        let Some(cache_entry) = cache.0.get_mut(&minecraft_version) else {
            continue;
        };
        let max = loader_versions
            .iter()
            .max()
            .expect("No loader version, despite this call only being reachable with min 1 entry");
        let min = loader_versions
            .iter()
            .min()
            .expect("No loader version, despite this call only being reachable with min 1 entry");
        let exclude = (*min..=*max)
            .filter(|i| !loader_versions.contains(i))
            .collect();

        cache_entry.3.insert(
            *modification,
            VersionBuild::Range(Some(prefix), *min, *max, exclude),
        );
    }

    Ok(())
}
