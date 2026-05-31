use crate::templates::utils::ReqwestJsonExtension as _;
use core::time::Duration;
use either::Either;
use indexmap::IndexSet;
use serde::Deserialize;
use std::sync::Mutex;
use std::time::Instant;
use tracing::{debug, error};
use url::Url;

static LOCK: Mutex<Option<Instant>> = Mutex::new(None);

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

pub(crate) async fn list_docker_tags(image: impl Into<String>) -> Result<IndexSet<String>, ()> {
    let client = reqwest::Client::builder()
        .build()
        .inspect_err(|err| {
            error!(
                "Unable to build cache update client (for docker): {:?}",
                err
            );
        })
        .map_err(|_err| ())?;

    let image = image.into();
    let url = format!("https://hub.docker.com/v2/repositories/library/{image}/tags?page_size=100");
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
    while let Some(url) = initial.next {
        debug!("Trying {}", url);
        initial = client
            .get(url)
            .send()
            .await
            .inspect_err(|err| {
                error!(
                    "Unable to send docker tag list request for image {}: {:?}",
                    image, err
                );
            })
            .map_err(|_err| ())?
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
