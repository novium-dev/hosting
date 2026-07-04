use reqwest::Client;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use tracing::error;

use crate::templates::games::minecraft::{MinecraftServerModification, VersionBuild, VersionCache};

#[derive(Deserialize)]
pub(crate) struct PaperAPIProject {
    pub(crate) version_groups: HashSet<String>,
}

#[derive(Deserialize)]
pub(crate) struct PaperAPIVersionGroup {
    pub(crate) builds: Vec<PaperAPIVersion>,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum PaperAPIChannel {
    Alpha,
    Beta,
    Stable,
    Recommended,
}

#[derive(Deserialize)]
pub(crate) struct PaperAPIVersion {
    pub(crate) version: String,
    pub(crate) build: u16,
    pub(crate) channel: PaperAPIChannel,
}

pub(crate) async fn resolve(
    client: &Client,
    modification: &MinecraftServerModification,
    cache: &mut VersionCache,
    url: &str,
    project_name: &str,
) -> Result<(), ()> {
    let project: PaperAPIProject = client
        .get(format!("{url}v2/projects/{project_name}"))
        .send()
        .await
        .inspect_err(|err| error!("Unable to send paper project {project_name:?} request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get paper project {project_name:?}: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| {
            error!("Unable to parse paper project {project_name:?} response: {err:?}");
        })
        .map_err(|_err| ())?;
    for group in project.version_groups {
        let project: PaperAPIVersionGroup = client
            .get(format!(
                "{url}v2/projects/{project_name}/version_group/{group}/builds"
            ))
            .send()
            .await
            .inspect_err(|err| error!("Unable to send paper project {project_name:?} for group {group:?} builds list request: {err:?}"))
            .map_err(|_err| ())?
            .error_for_status()
            .inspect_err(|err| error!("Unable to get paper project {project_name:?} for group {group:?} builds list: {err:?}"))
            .map_err(|_err| ())?
            .json()
            .await
            .inspect_err(|err| error!("Unable to receive paper project {project_name:?} for group {group:?} builds list response: {err:?}"))
            .map_err(|_err| ())?;

        let mut map: HashMap<String, HashSet<u16>> = HashMap::new();
        for ver in project.builds {
            if PaperAPIChannel::Recommended == ver.channel || PaperAPIChannel::Stable == ver.channel
            {
                map.entry(ver.version.clone())
                    .or_default()
                    .insert(ver.build);
            }
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
    }
    Ok(())
}
