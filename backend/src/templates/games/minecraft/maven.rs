use serde::Deserialize;

#[derive(Deserialize)]
pub(crate) struct MavenMetadata {
    pub(crate) versioning: MavenVersioning,
}

#[derive(Deserialize)]
pub(crate) struct MavenVersioning {
    pub(crate) versions: MavenVersions,
}

#[derive(Deserialize)]
pub(crate) struct MavenVersions {
    pub(crate) version: Vec<String>,
}
