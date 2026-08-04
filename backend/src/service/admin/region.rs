use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ManagementPermissions;
use crate::db::region::RegionId;
use crate::service::admin::region::region_admin_service_error::{
    CreateRegionError, DeleteRegionError, ListRegionsError, UpdateRegionError,
};
use crate::service::error_region_slug_invalid::FromRegionSlugInvalid;
use crate::service::*;
use serde::Serialize;
use sqlx::query;
use zelus::service;

const SLUG_MAX_LENGTH: usize = 64;

fn validate_slug<E: FromRegionSlugInvalid>(slug: &str) -> Result<(), E> {
    let valid = !slug.is_empty()
        && slug.len() <= SLUG_MAX_LENGTH
        && slug
            .chars()
            .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-');

    if valid {
        Ok(())
    } else {
        Err(<E as FromRegionSlugInvalid>::from())
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct RegionInfo {
    pub(crate) id: RegionId,
    pub(crate) slug: String,
    pub(crate) display: String,
    pub(crate) node_count: i64,
}

#[service(path = "/admin/region", tag = "region", no_sdk)]
pub(crate) impl RegionAdminService for Backend {
    /// Lists all regions together with the number of nodes assigned to each.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_VIEW`].
    #[route("", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*])]
    async fn list_regions(&self, #[special] auth: Authentication) -> Result<Vec<RegionInfo>, _> {
        auth.require::<_, _, ListRegionsError>((), ManagementPermissions::NODES_VIEW)?;

        Ok(query!(
            r#"SELECT
                regions.id AS "id: RegionId",
                regions.slug,
                regions.display,
                (SELECT COUNT(*) FROM nodes WHERE nodes.region = regions.id) AS "node_count!"
             FROM regions
             ORDER BY regions.slug"#
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|region| RegionInfo {
            id: region.id,
            slug: region.slug,
            display: region.display,
            node_count: region.node_count,
        })
        .collect())
    }

    /// Creates a new region nodes can be assigned to.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("", method = PUT)]
    #[error(auth::{permission_denied, unreachable}, region::{slug_invalid, slug_taken <- [sql:unique]}, db::failure <- [sql:*])]
    async fn create_region(
        &self,
        #[special] auth: Authentication,
        slug: String,
        display: String,
    ) -> Result<String, _> {
        auth.require::<_, _, CreateRegionError>((), ManagementPermissions::NODES_MANAGE)?;

        validate_slug::<CreateRegionError>(&slug)?;

        let id = RegionId::generate();

        query!(
            "INSERT INTO regions (id, slug, display) VALUES ($1, $2, $3)",
            &id,
            slug,
            display
        )
        .execute(&*self.database)
        .await?;

        Ok(id.to_string())
    }

    /// Updates a region's slug or display name.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{region_id}", method = PATCH)]
    #[error(auth::{permission_denied, unreachable}, region::{not_found <- [sql:not_found], slug_invalid, slug_taken <- [sql:unique]}, db::failure <- [sql:*])]
    async fn update_region(
        &self,
        #[special] auth: Authentication,
        region_id: RegionId,
        slug: Option<String>,
        display: Option<String>,
    ) -> Result<(), _> {
        auth.require::<_, _, UpdateRegionError>((), ManagementPermissions::NODES_MANAGE)?;

        if let Some(slug) = slug.as_deref() {
            validate_slug::<UpdateRegionError>(slug)?;
        }

        let mut tx = self.database.begin().await?;

        if let Some(slug) = slug {
            query!(
                "UPDATE regions SET slug = $1 WHERE id = $2",
                slug,
                &region_id
            )
            .execute(&mut *tx)
            .await?;
        }

        if let Some(display) = display {
            query!(
                "UPDATE regions SET display = $1 WHERE id = $2",
                display,
                &region_id
            )
            .execute(&mut *tx)
            .await?;
        }

        query!(
            r#"SELECT id AS "id: RegionId" FROM regions WHERE id = $1"#,
            &region_id
        )
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(())
    }

    /// Deletes a region. The region must not have any nodes assigned to it.
    ///
    /// # Permissions
    /// Requires [`ManagementPermissions::NODES_MANAGE`].
    #[route("/{region_id}", method = DELETE)]
    #[error(auth::{permission_denied, unreachable}, region::{not_found, not_empty <- [sql:foreign_key]}, db::failure <- [sql:*])]
    async fn delete_region(
        &self,
        #[special] auth: Authentication,
        region_id: RegionId,
    ) -> Result<(), _> {
        auth.require::<_, _, DeleteRegionError>((), ManagementPermissions::NODES_MANAGE)?;

        let result = query!("DELETE FROM regions WHERE id = $1", &region_id)
            .execute(&*self.database)
            .await?;

        if result.rows_affected() == 0 {
            return Err(DeleteRegionError::RegionNotFound);
        }

        Ok(())
    }
}
