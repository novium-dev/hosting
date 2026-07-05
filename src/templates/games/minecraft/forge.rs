// https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml

use reqwest::Client;
use std::collections::HashMap;
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
        .get(format!("{url}/net/minecraftforge/forge/maven-metadata.xml"))
        .send()
        .await
        .inspect_err(|err| error!("Unable to send maven {url:?} metadata (forge) request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get maven {:?} metadata (forge): {:?}", url, err))
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

    let versions: Vec<_> = metadata
        .versioning
        .versions
        .version
        .into_iter()
        .filter_map(|ver| {
            ver.split_once('-')
                .map(|(minecraft_version, loader_version)| {
                    (minecraft_version.to_owned(), loader_version.to_owned())
                })
        })
        .collect();
    let mut versions_map: HashMap<_, Vec<_>> = HashMap::new();
    for (minecraft_version, loader_version) in versions {
        versions_map
            .entry(minecraft_version)
            .or_default()
            .push(loader_version);
    }

    for (minecraft_version, loader_versions) in versions_map {
        let Some(cache_entry) = cache.0.get_mut(&minecraft_version) else {
            continue;
        };
        cache_entry
            .3
            .insert(*modification, VersionBuild::Set(loader_versions));
    }

    Ok(())
}
