// https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml

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
    let versions: Vec<_> = metadata
        .versioning
        .versions
        .version
        .into_iter()
        .map(|ver| {
            ver.splitn(3, '.')
                .map(String::from)
                .collect::<Vec<String>>()
        })
        .filter_map(|ver| {
            Some((
                ver.first()?.parse::<u16>().ok()?,
                ver.get(1)?.parse::<u16>().ok()?,
                ver.get(2)?.parse::<u16>().ok()?,
            ))
        })
        .collect();
    let mut versions_map: HashMap<_, HashSet<u16>> = HashMap::new();
    for (mc_minor, mc_patch, loader_version) in versions {
        versions_map
            .entry((mc_minor, mc_patch))
            .or_default()
            .insert(loader_version);
    }

    for ((mc_minor, mc_patch), loader_versions) in versions_map {
        let minecraft_version = format!("1.{mc_minor}.{mc_patch}");
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
            VersionBuild::Range(Some(format!("{mc_minor}.{mc_patch}.")), *min, *max, exclude),
        );
    }

    Ok(())
}
