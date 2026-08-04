use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::ServerId;
use crate::service::error_feature_disabled::FromFeatureDisabled;
use serde::{Deserialize, Serialize};
use sqlx::{query, query_scalar};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectFeature {
    ModInstaller,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ProjectFeatureInfo {
    pub id: ProjectFeature,
    pub display: &'static str,
    pub description: &'static str,
}

impl ProjectFeature {
    pub const ALL: &'static [Self] = &[Self::ModInstaller];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ModInstaller => "mod_installer",
        }
    }

    pub const fn info(self) -> ProjectFeatureInfo {
        match self {
            Self::ModInstaller => ProjectFeatureInfo {
                id: self,
                display: "Mod installer",
                description: "Browse and install mods, plugins and modpacks from the server view.",
            },
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|feature| feature.as_str() == value)
    }
}

fn ordered(features: &HashSet<ProjectFeature>) -> Vec<ProjectFeature> {
    ProjectFeature::ALL
        .iter()
        .copied()
        .filter(|feature| features.contains(feature))
        .collect()
}

impl Backend {
    pub(crate) async fn project_features(
        &self,
        project: ProjectId,
    ) -> Result<Vec<ProjectFeature>, sqlx::Error> {
        let features = query_scalar!(
            "SELECT feature FROM project_features WHERE project = $1",
            &project
        )
        .fetch_all(&*self.database)
        .await?
        .iter()
        .filter_map(|feature| ProjectFeature::parse(feature))
        .collect();

        Ok(ordered(&features))
    }

    pub(crate) async fn all_project_features(
        &self,
    ) -> Result<HashMap<ProjectId, Vec<ProjectFeature>>, sqlx::Error> {
        let mut grouped: HashMap<ProjectId, HashSet<ProjectFeature>> = HashMap::new();

        for row in
            query!(r#"SELECT project AS "project: ProjectId", feature FROM project_features"#)
                .fetch_all(&*self.database)
                .await?
        {
            if let Some(feature) = ProjectFeature::parse(&row.feature) {
                grouped.entry(row.project).or_default().insert(feature);
            }
        }

        Ok(grouped
            .iter()
            .map(|(project, features)| (*project, ordered(features)))
            .collect())
    }

    pub(crate) async fn require_server_feature<E>(
        &self,
        server: ServerId,
        feature: ProjectFeature,
    ) -> Result<(), E>
    where
        E: FromFeatureDisabled + From<sqlx::Error>,
    {
        let enabled = query_scalar!(
            r#"SELECT (COUNT(*) > 0) AS "enabled!"
               FROM project_features
               JOIN servers ON servers.project = project_features.project
               WHERE servers.id = $1 AND project_features.feature = $2"#,
            &server,
            feature.as_str()
        )
        .fetch_one(&*self.database)
        .await?;

        if enabled {
            Ok(())
        } else {
            Err(<E as FromFeatureDisabled>::from())
        }
    }
}
