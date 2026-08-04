use reqwest::Client;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use tracing::error;

use crate::templates::games::minecraft::{MinecraftServerModification, VersionBuild, VersionCache};
use crate::utils::serde::SerdeStringToU16Wrapper;

#[derive(Deserialize)]
pub(crate) struct PurpurAPIProject {
    pub(crate) versions: HashSet<String>,
}

#[derive(Deserialize)]
pub(crate) struct PurpurAPIVersion {
    pub(crate) builds: PurpurAPIBuilds,
}

#[derive(Deserialize)]
pub(crate) struct PurpurAPIBuilds {
    pub(crate) all: Vec<SerdeStringToU16Wrapper>,
}

pub(crate) async fn resolve(
    client: &Client,
    modification: &MinecraftServerModification,
    cache: &mut VersionCache,
    url: &str,
    project_name: &str,
) -> Result<(), ()> {
    let project: PurpurAPIProject = client
        .get(format!("{url}v2/{project_name}"))
        .send()
        .await
        .inspect_err(|err| {
            error!("Unable to send purpur project {project_name:?} request: {err:?}");
        })
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get purpur project {project_name:?}: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| {
            error!("Unable to receive purpur project {project_name:?} response: {err:?}");
        })
        .map_err(|_err| ())?;
    let mut map: HashMap<String, HashSet<u16>> = HashMap::new();
    for version in project.versions {
        let project: PurpurAPIVersion = client
            .get(format!("{url}v2/{project_name}/{version}"))
            .send()
            .await
            .inspect_err(|err| error!("Unable to send purpur project {project_name:?} for group {version:?} builds list request: {err:?}"))
            .map_err(|_err| ())?
            .error_for_status()
            .inspect_err(|err| error!("Unable to get purpur project {project_name:?} for group {version:?} builds list: {err:?}"))
            .map_err(|_err| ())?
            .json()
            .await
            .inspect_err(|err| error!("Unable to receive purpur project {project_name:?} for group {version:?} builds list response: {err:?}"))
            .map_err(|_err| ())?;
        map.insert(
            version.clone(),
            project.builds.all.into_iter().map(Into::into).collect(),
        );
    }
    for (ver, builds) in map {
        let Some(cache_entry) = cache.0.get_mut(&ver) else {
            continue;
        };
        let min = builds
            .iter()
            .min()
            .expect("No build number, despite this call only being reachable with min 1 entry");
        let max = builds
            .iter()
            .max()
            .expect("No build number, despite this call only being reachable with min 1 entry");
        let mut exclude = HashSet::new();
        for i in *min..=*max {
            if !builds.contains(&i) {
                exclude.insert(i);
            }
        }
        cache_entry.3.insert(
            *modification,
            VersionBuild::Range(None, *min, *max, exclude),
        );
    }
    Ok(())
}
