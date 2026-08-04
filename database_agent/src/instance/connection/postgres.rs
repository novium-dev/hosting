use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::QueryResult;
use std::path::PathBuf;
use tokio_postgres::{Client, NoTls, SimpleQueryMessage};

const ADMIN_USER: &str = "postgres";
const ADMIN_DATABASE: &str = "postgres";

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub struct PostgresConnection {
    socket: PathBuf,
}

impl PostgresConnection {
    pub const fn new(socket: PathBuf) -> Self {
        Self { socket }
    }

    async fn client(&self, database: &str) -> anyhow::Result<Client> {
        let stream = tokio::net::UnixStream::connect(&self.socket).await?;
        let (client, connection) = tokio_postgres::Config::new()
            .user(ADMIN_USER)
            .dbname(database)
            .connect_raw(stream, NoTls)
            .await?;

        tokio::spawn(async move {
            if let Err(err) = connection.await {
                tracing::debug!("postgres admin connection error: {err}");
            }
        });

        Ok(client)
    }

    async fn execute(&self, sql: &str) -> anyhow::Result<()> {
        self.client(ADMIN_DATABASE).await?.simple_query(sql).await?;
        Ok(())
    }

    pub async fn create_user(
        &self,
        user: &UserIdentifier,
        password: &str,
    ) -> anyhow::Result<()> {
        self.execute(&format!(
            "CREATE ROLE {} LOGIN PASSWORD {}",
            quote_ident(&user.to_string()),
            quote_literal(password)
        ))
        .await
    }

    pub async fn update_user_password(
        &self,
        user: &UserIdentifier,
        password: &str,
    ) -> anyhow::Result<()> {
        self.execute(&format!(
            "ALTER ROLE {} PASSWORD {}",
            quote_ident(&user.to_string()),
            quote_literal(password)
        ))
        .await
    }

    pub async fn delete_user(&self, user: &UserIdentifier) -> anyhow::Result<()> {
        self.execute(&format!(
            "DROP ROLE IF EXISTS {}",
            quote_ident(&user.to_string())
        ))
        .await
    }

    pub async fn grant_user(&self, user: &UserIdentifier, database: &str) -> anyhow::Result<()> {
        let user = quote_ident(&user.to_string());
        self.execute(&format!(
            "GRANT ALL PRIVILEGES ON DATABASE {} TO {user}",
            quote_ident(database)
        ))
        .await?;

        self.client(database)
            .await?
            .simple_query(&format!("GRANT ALL ON SCHEMA public TO {user}"))
            .await?;

        Ok(())
    }

    pub async fn create_database(&self, name: &str) -> anyhow::Result<()> {
        self.execute(&format!("CREATE DATABASE {}", quote_ident(name)))
            .await
    }

    pub async fn delete_database(&self, name: &str) -> anyhow::Result<()> {
        self.execute(&format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            quote_ident(name)
        ))
        .await
    }

    pub async fn recreate_database(
        &self,
        name: &str,
        users: &[UserIdentifier],
    ) -> anyhow::Result<()> {
        self.delete_database(name).await?;
        self.create_database(name).await?;

        for user in users {
            self.grant_user(user, name).await?;
        }

        Ok(())
    }

    pub async fn database_size(&self, name: &str) -> anyhow::Result<i64> {
        let row = self
            .client(ADMIN_DATABASE)
            .await?
            .query_one("SELECT pg_database_size($1)", &[&name])
            .await?;

        Ok(row.get::<_, i64>(0))
    }

    pub async fn query(&self, database: Option<&str>, query: &str) -> anyhow::Result<QueryResult> {
        let client = self.client(database.unwrap_or(ADMIN_DATABASE)).await?;

        let mut result = QueryResult::default();
        for message in client.simple_query(query).await? {
            match message {
                SimpleQueryMessage::RowDescription(columns) => {
                    result.columns = columns
                        .iter()
                        .map(|column| column.name().to_owned())
                        .collect();
                }
                SimpleQueryMessage::Row(row) => {
                    result.rows.push(
                        (0..row.len())
                            .map(|index| {
                                row.get(index).map_or(serde_json::Value::Null, |value| {
                                    serde_json::Value::String(value.to_owned())
                                })
                            })
                            .collect(),
                    );
                }
                SimpleQueryMessage::CommandComplete(count) => {
                    result.rows_affected = result.rows_affected.saturating_add(count);
                }
                _ => {}
            }
        }

        Ok(result)
    }
}
