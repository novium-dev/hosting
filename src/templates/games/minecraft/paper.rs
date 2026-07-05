use reqwest::Client;
use serde::Deserialize;
use std::collections::HashSet;
use tracing::error;

use crate::templates::games::minecraft::{MinecraftServerModification, VersionBuild, VersionCache};

#[derive(Deserialize)]
pub(crate) struct PaperAPIVersionsResponse {
    pub(crate) versions: Vec<PaperAPIVersionEntry>,
}

#[derive(Deserialize)]
pub(crate) struct PaperAPIVersionEntry {
    pub(crate) version: PaperAPIVersionId,
}

#[derive(Deserialize)]
pub(crate) struct PaperAPIVersionId {
    pub(crate) id: String,
}

#[derive(Deserialize)]
pub(crate) struct PaperAPIBuildsResponse {
    pub(crate) builds: Vec<PaperAPIBuild>,
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
pub(crate) struct PaperAPIBuild {
    pub(crate) id: u16,
    pub(crate) channel: PaperAPIChannel,
}

pub(crate) async fn resolve(
    client: &Client,
    modification: &MinecraftServerModification,
    cache: &mut VersionCache,
    url: &str,
    project_name: &str,
) -> Result<(), ()> {
    let versions: PaperAPIVersionsResponse = client
        .get(format!("{url}v3/projects/{project_name}/versions"))
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

    for version in versions.versions {
        let ver = version.version.id;

        let Some(cache_entry) = cache.0.get_mut(&ver) else {
            continue;
        };

        let builds_resp: PaperAPIBuildsResponse = client
            .get(format!(
                "{url}v3/projects/{project_name}/versions/{ver}/builds"
            ))
            .send()
            .await
            .inspect_err(|err| error!("Unable to send paper project {project_name:?} for version {ver:?} builds list request: {err:?}"))
            .map_err(|_err| ())?
            .error_for_status()
            .inspect_err(|err| error!("Unable to get paper project {project_name:?} for version {ver:?} builds list: {err:?}"))
            .map_err(|_err| ())?
            .json()
            .await
            .inspect_err(|err| error!("Unable to receive paper project {project_name:?} for version {ver:?} builds list response: {err:?}"))
            .map_err(|_err| ())?;

        let mut builds: HashSet<u16> = HashSet::new();
        for build in builds_resp.builds {
            if PaperAPIChannel::Recommended == build.channel
                || PaperAPIChannel::Stable == build.channel
            {
                builds.insert(build.id);
            }
        }
        if builds.is_empty() {
            continue;
        }

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