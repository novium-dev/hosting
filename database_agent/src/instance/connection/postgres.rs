use super::DatabaseGrant;
use core::fmt::Write as _;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::{DatabaseAccess, QueryResult};
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

const fn database_privileges(access: DatabaseAccess) -> &'static str {
    match access {
        DatabaseAccess::Read => "CONNECT",
        DatabaseAccess::Write => "ALL PRIVILEGES",
    }
}

const fn schema_privileges(access: DatabaseAccess) -> &'static str {
    match access {
        DatabaseAccess::Read => "USAGE",
        DatabaseAccess::Write => "ALL",
    }
}

const fn table_privileges(access: DatabaseAccess) -> &'static str {
    match access {
        DatabaseAccess::Read => "SELECT",
        DatabaseAccess::Write => "ALL",
    }
}

const fn sequence_privileges(access: DatabaseAccess) -> &'static str {
    match access {
        DatabaseAccess::Read => "SELECT, USAGE",
        DatabaseAccess::Write => "ALL",
    }
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

    pub async fn create_user(&self, user: &UserIdentifier, password: &str) -> anyhow::Result<()> {
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

    pub async fn delete_user(
        &self,
        user: &UserIdentifier,
        databases: &[String],
    ) -> anyhow::Result<()> {
        let role = quote_ident(&user.to_string());

        for database in databases {
            self.client(database)
                .await?
                .simple_query(&format!(
                    "REASSIGN OWNED BY {role} TO {ADMIN_USER}; DROP OWNED BY {role};"
                ))
                .await?;
        }

        self.execute(&format!("DROP ROLE IF EXISTS {role}")).await
    }

    pub async fn sync_grants(
        &self,
        database: &str,
        grants: &[DatabaseGrant],
        revoked: &[UserIdentifier],
    ) -> anyhow::Result<()> {
        let quoted_database = quote_ident(database);
        let roles: Vec<String> = grants
            .iter()
            .map(|grant| quote_ident(&grant.user.to_string()))
            .chain(revoked.iter().map(|user| quote_ident(&user.to_string())))
            .collect();

        let mut cluster = format!("REVOKE ALL ON DATABASE {quoted_database} FROM PUBLIC;");
        let mut schema = String::new();

        for role in &roles {
            write!(
                cluster,
                "REVOKE ALL PRIVILEGES ON DATABASE {quoted_database} FROM {role};"
            )?;
            write!(
                schema,
                "REVOKE ALL ON SCHEMA public FROM {role};
                 REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role};
                 REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role};"
            )?;

            for other in roles.iter().filter(|other| *other != role) {
                write!(
                    schema,
                    "ALTER DEFAULT PRIVILEGES FOR ROLE {role} IN SCHEMA public
                         REVOKE ALL ON TABLES FROM {other};
                     ALTER DEFAULT PRIVILEGES FOR ROLE {role} IN SCHEMA public
                         REVOKE ALL ON SEQUENCES FROM {other};"
                )?;
            }
        }

        for grant in grants {
            let role = quote_ident(&grant.user.to_string());

            write!(
                cluster,
                "GRANT {} ON DATABASE {quoted_database} TO {role};",
                database_privileges(grant.access)
            )?;
            write!(
                schema,
                "GRANT {} ON SCHEMA public TO {role};
                 GRANT {} ON ALL TABLES IN SCHEMA public TO {role};
                 GRANT {} ON ALL SEQUENCES IN SCHEMA public TO {role};",
                schema_privileges(grant.access),
                table_privileges(grant.access),
                sequence_privileges(grant.access)
            )?;
        }

        for writer in grants.iter().filter(|grant| grant.access.is_write()) {
            let owner = quote_ident(&writer.user.to_string());

            for other in grants.iter().filter(|grant| grant.user != writer.user) {
                let role = quote_ident(&other.user.to_string());

                write!(
                    schema,
                    "ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public
                         GRANT {} ON TABLES TO {role};
                     ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA public
                         GRANT {} ON SEQUENCES TO {role};",
                    table_privileges(other.access),
                    sequence_privileges(other.access)
                )?;
            }
        }

        if roles.is_empty() {
            return Ok(());
        }

        self.execute(&cluster).await?;
        self.client(database).await?.simple_query(&schema).await?;

        Ok(())
    }

    pub async fn create_database(&self, name: &str) -> anyhow::Result<()> {
        let database = quote_ident(name);
        self.execute(&format!("CREATE DATABASE {database}")).await?;
        self.execute(&format!("REVOKE ALL ON DATABASE {database} FROM PUBLIC"))
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
        grants: &[DatabaseGrant],
    ) -> anyhow::Result<()> {
        self.delete_database(name).await?;
        self.create_database(name).await?;

        self.sync_grants(name, grants, &[]).await
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
