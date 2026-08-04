use reqwest::Client;
use serde::Deserialize;
use tracing::error;

use crate::templates::games::minecraft::{MinecraftServerModification, VersionBuild, VersionCache};

#[derive(Deserialize)]
pub(crate) struct FabricLoaderVersion {
    pub(crate) version: String,
}

#[derive(Deserialize)]
pub(crate) struct FabricVersion {
    pub(crate) loader: FabricLoaderVersion,
}

pub(crate) async fn resolve(
    client: &Client,
    modification: &MinecraftServerModification,
    cache: &mut VersionCache,
    url: &str,
) -> Result<(), ()> {
    let supported: Vec<FabricLoaderVersion> = client
        .get(format!("{url}/versions/game"))
        .send()
        .await
        .inspect_err(|err| error!("Unable to send fabric game project request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get fabric game project: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive fabric game project response: {err:?}"))
        .map_err(|_err| ())?;
    let supported: Vec<_> = supported.into_iter().map(|ver| ver.version).collect();

    for minecraft_version in supported {
        let Some(cache_entry) = cache.0.get_mut(&minecraft_version) else {
            continue;
        };
        let mut loaders: Option<Vec<FabricVersion>> = None;
        for _ in 1u8..=20u8 {
            if let Ok(vers) = client
            .get(format!("{url}/versions/loader/{minecraft_version}"))
            .send()
            .await
            .inspect_err(|err| error!("Unable to send fabric game project for group {minecraft_version:?} loader list request: {err:?}"))
            .map_err(|_err| ())?
            .error_for_status()
            .inspect_err(|err| error!("Unable to get fabric game project for group {minecraft_version:?} loader list: {err:?}"))
            .map_err(|_err| ())?
            .json()
            .await
            .inspect_err(|err| error!("Unable to receive game project for group {minecraft_version:?} loader list response: {err:?}")) {
                loaders = Some(vers);
                break;
            }
        }
        if let Some(loaders) = loaders {
            cache_entry.3.insert(
                *modification,
                VersionBuild::Set(loaders.into_iter().map(|ver| ver.loader.version).collect()),
            );
        }
    }

    Ok(())
}
