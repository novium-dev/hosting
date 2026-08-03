use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::feature::{ProjectFeature, ProjectFeatureInfo};
use crate::db::project::ProjectId;
use crate::service::admin::project::project_admin_service_error::{
    ListProjectFeaturesError, SetProjectFeaturesError,
};
use crate::service::*;
use serde::{Deserialize, Serialize};
use sqlx::{Connection as _, query};
use std::collections::HashSet;
use zelus::service;

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ProjectFeaturesRequest {
    pub features: Vec<ProjectFeature>,
}

#[service(path = "/admin/project", tag = "project", no_sdk)]
pub(crate) impl ProjectAdminService for Backend {
    /// Lists every feature flag this instance knows about.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::FEATURES_MANAGE`].
    #[route("/features", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_project_features(
        &self,
        #[special] auth: Authentication,
    ) -> Result<Vec<ProjectFeatureInfo>, _> {
        auth.require::<_, _, ListProjectFeaturesError>((), ManagementPermissions::FEATURES_MANAGE)?;

        Ok(ProjectFeature::ALL
            .iter()
            .copied()
            .map(ProjectFeature::info)
            .collect())
    }

    /// Replaces the set of feature flags enabled for a project.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::FEATURES_MANAGE`].
    #[route("/{project_id}/features", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, project::not_found <- [sql:not_found], db::failure <- [sql:*])]
    async fn set_project_features(
        &self,
        #[special] auth: Authentication,
        project_id: ProjectId,
        features: ProjectFeaturesRequest,
    ) -> Result<(), _> {
        auth.require::<_, _, SetProjectFeaturesError>((), ManagementPermissions::FEATURES_MANAGE)?;

        let features: HashSet<ProjectFeature> = features.features.into_iter().collect();

        let mut conn = self.database.acquire().await?;
        conn.transaction(|tx| {
            Box::pin(async move {
                query!(
                    r#"SELECT id AS "id: ProjectId" FROM projects WHERE id = $1"#,
                    &project_id
                )
                .fetch_one(&mut **tx)
                .await?;

                query!(
                    "DELETE FROM project_features WHERE project = $1",
                    &project_id
                )
                .execute(&mut **tx)
                .await?;

                for feature in features {
                    query!(
                        "INSERT INTO project_features (project, feature) VALUES ($1, $2)",
                        &project_id,
                        feature.as_str()
                    )
                    .execute(&mut **tx)
                    .await?;
                }

                Ok::<_, SetProjectFeaturesError>(())
            })
        })
        .await
    }
}
