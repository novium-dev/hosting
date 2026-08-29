use reqwest::Client;
use serde::Deserialize;
use std::collections::HashSet;
use tracing::error;

use crate::templates::games::minecraft::VersionBuild;
use crate::templates::games::minecraft_proxy::{DEFAULT_JAVA, VelocityVersion};

const PROJECT: &str = "velocity";

#[derive(Deserialize)]
pub(crate) struct FillVersionsResponse {
    pub(crate) versions: Vec<FillVersionEntry>,
}

#[derive(Deserialize)]
pub(crate) struct FillVersionEntry {
    pub(crate) version: FillVersion,
    pub(crate) builds: Vec<u16>,
}

#[derive(Deserialize)]
pub(crate) struct FillVersion {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) java: Option<FillJava>,
}

#[derive(Deserialize)]
pub(crate) struct FillJava {
    pub(crate) version: FillJavaVersion,
}

#[derive(Deserialize)]
pub(crate) struct FillJavaVersion {
    pub(crate) minimum: u8,
}

pub(crate) async fn resolve(client: &Client, url: &str) -> Result<Vec<VelocityVersion>, ()> {
    let response: FillVersionsResponse = client
        .get(format!("{url}v3/projects/{PROJECT}/versions"))
        .send()
        .await
        .inspect_err(|err| error!("Unable to send velocity versions request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get velocity versions: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive velocity versions response: {err:?}"))
        .map_err(|_err| ())?;

    let mut versions = Vec::new();
    for entry in response.versions {
        let builds: HashSet<u16> = entry.builds.into_iter().collect();
        let (Some(min), Some(max)) = (builds.iter().min(), builds.iter().max()) else {
            continue;
        };
        let exclude = (*min..=*max)
            .filter(|build| !builds.contains(build))
            .collect();

        versions.push(VelocityVersion {
            id: entry.version.id,
            java: entry
                .version
                .java
                .map_or(DEFAULT_JAVA, |java| java.version.minimum),
            builds: VersionBuild::Range(None, *min, *max, exclude),
        });
    }
    Ok(versions)
}
