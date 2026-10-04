use crate::Backend;
use crate::db::server::ServerId;
use serde::Serialize;
use sqlx::query;
use std::collections::HashMap;

pub struct License {
    pub id: &'static str,
    pub display: &'static str,
    pub description: &'static str,
    pub url: &'static str,
}

pub const MINECRAFT_EULA: License = License {
    id: "minecraft_eula",
    display: "Minecraft EULA",
    description: "Mojang requires the operator of every Minecraft server to accept the Minecraft End User License Agreement before the server may be run.",
    url: "https://aka.ms/MinecraftEULA",
};

pub const HYTALE_EULA: License = License {
    id: "hytale_eula",
    display: "Hytale EULA",
    description: "Hypixel Studios requires everyone who downloads, installs or uses Hytale, including its server software, to accept the Hytale End User License Agreement.",
    url: "https://hytale.com/eula",
};

pub const HYTALE_SERVER_POLICIES: License = License {
    id: "hytale_server_policies",
    display: "Hytale Server Operator Policies",
    description: "Every Hytale server operator must follow the Server Operator Policies, which cover monetization, gambling, loot box disclosures and revenue share.",
    url: "https://hytale.com/server-policies",
};

pub const TEAMSPEAK_LICENSE: License = License {
    id: "teamspeak_license",
    display: "TeamSpeak License",
    description: "TeamSpeak requires the operator of every TeamSpeak server to accept its terms and conditions before the server may be run.",
    url: "https://www.teamspeak.com/en/privacy-and-terms/",
};

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
}
