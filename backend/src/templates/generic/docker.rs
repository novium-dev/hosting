use crate::templates::utils::ReqwestJsonExtension as _;
use core::time::Duration;
use either::Either;
use indexmap::IndexSet;
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tracing::{debug, error, warn};
use url::Url;

static LOCK: Mutex<Option<Instant>> = Mutex::new(None);
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

const MAX_PAGES: usize = 5;

pub(crate) fn update() -> bool {
    let mut guard = LOCK.lock().expect("docker cache update lock poisoned");
    let update = guard
        .as_ref()
        .is_none_or(|instant| instant.elapsed() > Duration::from_hours(1));
    if update {
        *guard = Some(Instant::now());
    }
    drop(guard);
    update
}

#[derive(Debug, Deserialize)]
struct DockerImageTagsResponse {
    next: Option<Url>,
    results: Vec<DockerImageTag>,
}

#[derive(Debug, Deserialize)]
struct DockerImageTag {
    name: String,
}

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .build()
            .expect("failed to build docker client")
    })
}

pub(crate) async fn list_docker_tags(image: impl Into<String>) -> Result<IndexSet<String>, ()> {
    let client = client();

    let image = image.into();
    let url = format!(
        "https://hub.docker.com/v2/repositories/library/{image}/tags?page_size=50&ordering=last_updated"
    );
    let initial = Url::parse(&url)
        .inspect_err(|err| {
            error!(
                "Unable to parse url {:?} for docker tag retrieval: {:?}",
                url, err
            );
        })
        .map_err(|_err| ())?;
    let mut initial = DockerImageTagsResponse {
        next: Some(initial),
        results: Vec::new(),
    };
    let mut result = IndexSet::new();
    let mut pages = 0;
    while let Some(url) = initial.next {
        if pages >= MAX_PAGES {
            break;
        }
        pages += 1;

        debug!("Trying {}", url);
        let response = client
            .get(url)
            .send()
            .await
            .inspect_err(|err| {
                error!(
                    "Unable to send docker tag list request for image {}: {:?}",
                    image, err
                );
            })
            .map_err(|_err| ())?;

        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(60);
            warn!(
                "Rate limited fetching docker tags for {}, retry after {}s",
                image, retry_after
            );
            return Err(());
        }

        initial = response
            .error_for_status()
            .inspect_err(|err| {
                error!(
                    "Unable to get docker tag list for image {}: {:?}",
                    image, err
                );
            })
            .map_err(|_err| ())?
            .json_verbose()
            .await
            .inspect_err(|err| match err {
                Either::Left((bytes, err)) => error!(
                    "Unable to parse docker tag list for image {}: {:?}. Content: {:?}",
                    image,
                    err,
                    String::from_utf8_lossy(bytes)
                ),
                Either::Right(recv) => error!(
                    "Unable to receive docker tag list for image {}: {:?}",
                    image, recv
                ),
            })
            .map_err(|_err| ())?;
        debug!("Found {} tags", initial.results.len());
        result.extend(initial.results.into_iter().map(|result| result.name));
    }
    Ok(result)
}
