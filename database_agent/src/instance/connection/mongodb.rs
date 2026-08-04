use core::time::Duration;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::QueryResult;
use mongodb::bson::{Bson, Document, doc};
use mongodb::error::ErrorKind;
use mongodb::options::{ClientOptions, Credential, ServerAddress};
use mongodb::{Client, error};
use std::path::PathBuf;

const ADMIN_DATABASE: &str = "admin";
const UNAUTHORIZED: i32 = 13;

pub const ROOT_USERNAME: &str = "novium_root";

fn is_unauthorized(error: &error::Error) -> bool {
    matches!(*error.kind, ErrorKind::Command(ref command) if command.code == UNAUTHORIZED)
}

pub struct MongodbConnection {
    client: Client,
}

impl MongodbConnection {
    pub fn new(socket: PathBuf, root_password: Option<&str>) -> anyhow::Result<Self> {
        let options = ClientOptions::builder()
            .hosts(vec![ServerAddress::Unix { path: socket }])
            .direct_connection(true)
            .server_selection_timeout(Duration::from_secs(5))
            .credential(root_password.map(|password| {
                Credential::builder()
                    .username(ROOT_USERNAME.to_owned())
                    .password(password.to_owned())
                    .source(ADMIN_DATABASE.to_owned())
                    .build()
            }))
            .build();

        Ok(Self {
            client: Client::with_options(options)?,
        })
    }

    async fn run_admin(&self, command: Document) -> anyhow::Result<()> {
        self.client
            .database(ADMIN_DATABASE)
            .run_command(command)
            .await?;
        Ok(())
    }

    pub async fn create_root(&self, password: &str) -> anyhow::Result<()> {
        self.run_admin(doc! {
            "createUser": ROOT_USERNAME,
            "pwd": password,
            "roles": [{ "role": "root", "db": ADMIN_DATABASE }],
        })
        .await
    }

    pub async fn auth_enforced(&self) -> anyhow::Result<bool> {
        match self
            .client
            .database(ADMIN_DATABASE)
            .run_command(doc! { "usersInfo": 1i32 })
            .await
        {
            Ok(_) => Ok(false),
            Err(err) if is_unauthorized(&err) => Ok(true),
            Err(err) => Err(err.into()),
        }
    }

    pub async fn create_user(&self, user: &UserIdentifier, password: &str) -> anyhow::Result<()> {
        self.run_admin(doc! {
            "createUser": user.to_string(),
            "pwd": password,
            "roles": [],
        })
        .await
    }

    pub async fn update_user_password(
        &self,
        user: &UserIdentifier,
        password: &str,
    ) -> anyhow::Result<()> {
        self.run_admin(doc! {
            "updateUser": user.to_string(),
            "pwd": password,
        })
        .await
    }

    pub async fn delete_user(&self, user: &UserIdentifier) -> anyhow::Result<()> {
        self.run_admin(doc! { "dropUser": user.to_string() }).await
    }

    pub async fn grant_user(&self, user: &UserIdentifier, database: &str) -> anyhow::Result<()> {
        self.run_admin(doc! {
            "grantRolesToUser": user.to_string(),
            "roles": [{ "role": "dbOwner", "db": database }],
        })
        .await
    }

    pub async fn delete_database(&self, name: &str) -> anyhow::Result<()> {
        self.client.database(name).drop().await?;
        Ok(())
    }

    pub async fn recreate_database(&self, name: &str) -> anyhow::Result<()> {
        self.delete_database(name).await
    }

    pub async fn database_size(&self, name: &str) -> anyhow::Result<i64> {
        let stats = self
            .client
            .database(name)
            .run_command(doc! { "dbStats": 1i32, "scale": 1i32 })
            .await?;

        Ok(match stats.get("dataSize") {
            Some(&Bson::Int32(size)) => i64::from(size),
            Some(&Bson::Int64(size)) => size,
            Some(&Bson::Double(size)) => size as i64,
            _ => 0,
        })
    }

    pub async fn query(&self, database: Option<&str>, query: &str) -> anyhow::Result<QueryResult> {
        let command: Document = serde_json::from_str(query)?;

        let reply = self
            .client
            .database(database.unwrap_or(ADMIN_DATABASE))
            .run_command(command)
            .await?;

        Ok(QueryResult {
            columns: vec!["reply".to_owned()],
            rows: vec![vec![Bson::Document(reply).into_relaxed_extjson()]],
            rows_affected: 0,
        })
    }
}
