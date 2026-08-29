use reqwest::Client;
use serde::Deserialize;
use tracing::error;

const JOB: &str = "BungeeCord";
const RESULT_SUCCESS: &str = "SUCCESS";
const MAX_BUILDS: usize = 50;

#[derive(Deserialize)]
pub(crate) struct JenkinsJob {
    pub(crate) builds: Vec<JenkinsBuild>,
}

#[derive(Deserialize)]
pub(crate) struct JenkinsBuild {
    pub(crate) number: u16,
    #[serde(default)]
    pub(crate) result: Option<String>,
}

pub(crate) async fn resolve(client: &Client, url: &str) -> Result<Vec<u16>, ()> {
    let job: JenkinsJob = client
        .get(format!("{url}job/{JOB}/api/json"))
        .query(&[("tree", "builds[number,result]")])
        .send()
        .await
        .inspect_err(|err| error!("Unable to send bungeecord builds request: {err:?}"))
        .map_err(|_err| ())?
        .error_for_status()
        .inspect_err(|err| error!("Unable to get bungeecord builds: {err:?}"))
        .map_err(|_err| ())?
        .json()
        .await
        .inspect_err(|err| error!("Unable to receive bungeecord builds response: {err:?}"))
        .map_err(|_err| ())?;

    let mut builds: Vec<u16> = job
        .builds
        .into_iter()
        .filter(|build| build.result.as_deref() == Some(RESULT_SUCCESS))
        .map(|build| build.number)
        .collect();
    builds.sort_unstable_by(|left, right| right.cmp(left));
    builds.truncate(MAX_BUILDS);

    if builds.is_empty() {
        error!("Bungeecord builds response did not contain a successful build");
        return Err(());
    }

    Ok(builds)
}
