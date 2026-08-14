use crate::Backend;
use crate::db::server::ServerId;
use daemon_common::service::server::{ServerBuildPayload, ServerFileWrite};
use serde::Serialize;
use sqlx::query;
use std::collections::HashMap;
use std::collections::hash_map::Entry;

pub struct LicenseProperty {
    pub path: &'static str,
    pub key: &'static str,
    pub value: &'static str,
}

pub struct LicenseEnvironment {
    pub key: &'static str,
    pub value: &'static str,
}

pub struct LicenseEffect {
    pub properties: &'static [LicenseProperty],
    pub environment: &'static [LicenseEnvironment],
}

pub struct License {
    pub id: &'static str,
    pub display: &'static str,
    pub description: &'static str,
    pub url: &'static str,
    pub effect: LicenseEffect,
}

pub const MINECRAFT_EULA: License = License {
    id: "minecraft_eula",
    display: "Minecraft EULA",
    description: "Mojang requires the operator of every Minecraft server to accept the Minecraft End User License Agreement before the server may be run.",
    url: "https://aka.ms/MinecraftEULA",
    effect: LicenseEffect {
        properties: &[LicenseProperty {
            path: "eula.txt",
            key: "eula",
            value: "true",
        }],
        environment: &[],
    },
};

pub static ALL: &[&License] = &[&MINECRAFT_EULA];

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ServerLicenseInfo {
    pub id: &'static str,
    pub display: &'static str,
    pub description: &'static str,
    pub url: &'static str,
    pub accepted: bool,
    pub accepted_at: Option<i64>,
    pub accepted_by: Option<String>,
}

struct LicenseAcceptance {
    accepted_at: i64,
    accepted_by: Option<String>,
}

impl License {
    #[must_use]
    pub fn by_id(id: &str) -> Option<&'static Self> {
        ALL.iter().copied().find(|license| license.id == id)
    }

    pub(crate) fn apply(&self, build: &mut ServerBuildPayload) {
        for property in self.effect.properties {
            match build.files_write.entry(property.path.to_owned()) {
                Entry::Occupied(mut entry) => {
                    if let ServerFileWrite::JavaProperties { content } = entry.get_mut() {
                        content.insert(property.key.to_owned(), property.value.to_owned());
                    }
                }
                Entry::Vacant(entry) => {
                    entry.insert(ServerFileWrite::JavaProperties {
                        content: HashMap::from([(
                            property.key.to_owned(),
                            property.value.to_owned(),
                        )]),
                    });
                }
            }
        }

        for environment in self.effect.environment {
            build
                .environment
                .insert(environment.key.to_owned(), environment.value.to_owned());
        }
    }
}

impl Backend {
    async fn license_acceptances(
        &self,
        server: ServerId,
    ) -> Result<HashMap<String, LicenseAcceptance>, sqlx::Error> {
        Ok(query!(
            r#"SELECT
                 server_licenses.license AS "license!",
                 server_licenses.accepted_at AS "accepted_at!",
                 users.username AS "username?"
               FROM server_licenses
               LEFT JOIN users ON users.id = server_licenses.accepted_by
               WHERE server_licenses.server = $1"#,
            &server
        )
        .fetch_all(&*self.database)
        .await?
        .into_iter()
        .map(|row| {
            (
                row.license,
                LicenseAcceptance {
                    accepted_at: row.accepted_at.timestamp(),
                    accepted_by: row.username,
                },
            )
        })
        .collect())
    }

    pub(crate) async fn license_states(
        &self,
        server: ServerId,
        licenses: &'static [&'static License],
    ) -> Result<Vec<ServerLicenseInfo>, sqlx::Error> {
        if licenses.is_empty() {
            return Ok(Vec::new());
        }

        let mut acceptances = self.license_acceptances(server).await?;

        Ok(licenses
            .iter()
            .map(|license| {
                let acceptance = acceptances.remove(license.id);

                ServerLicenseInfo {
                    id: license.id,
                    display: license.display,
                    description: license.description,
                    url: license.url,
                    accepted: acceptance.is_some(),
                    accepted_at: acceptance.as_ref().map(|entry| entry.accepted_at),
                    accepted_by: acceptance.and_then(|entry| entry.accepted_by),
                }
            })
            .collect())
    }

    pub(crate) async fn license_pending(
        &self,
        server: ServerId,
        licenses: &'static [&'static License],
    ) -> Result<Vec<&'static License>, sqlx::Error> {
        if licenses.is_empty() {
            return Ok(Vec::new());
        }

        let acceptances = self.license_acceptances(server).await?;

        Ok(licenses
            .iter()
            .copied()
            .filter(|license| !acceptances.contains_key(license.id))
            .collect())
    }

    pub(crate) async fn license_accept(
        &self,
        server: ServerId,
        license: &'static License,
        user: Option<i32>,
    ) -> Result<(), sqlx::Error> {
        query!(
            "INSERT INTO server_licenses (server, license, accepted_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (server, license) DO NOTHING",
            &server,
            license.id,
            user
        )
        .execute(&*self.database)
        .await?;

        Ok(())
    }

    pub(crate) async fn license_apply(
        &self,
        server: ServerId,
        licenses: &'static [&'static License],
        build: &mut ServerBuildPayload,
    ) -> Result<(), sqlx::Error> {
        if licenses.is_empty() {
            return Ok(());
        }

        let acceptances = self.license_acceptances(server).await?;

        for license in licenses
            .iter()
            .filter(|license| acceptances.contains_key(license.id))
        {
            license.apply(build);
        }

        Ok(())
    }
}
