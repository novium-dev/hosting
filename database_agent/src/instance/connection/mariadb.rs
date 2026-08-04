use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::QueryResult;
use mysql_async::prelude::{Query as _, Queryable as _, WithParams as _};
use mysql_async::{Conn, Opts, OptsBuilder, Row, Value};
use std::path::Path;

const ADMIN_USER: &str = "root";

fn quote_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn value_to_json(value: Value) -> serde_json::Value {
    match value {
        Value::NULL => serde_json::Value::Null,
        Value::Bytes(bytes) => {
            serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
        }
        Value::Int(number) => number.into(),
        Value::UInt(number) => number.into(),
        Value::Float(number) => serde_json::json!(number),
        Value::Double(number) => serde_json::json!(number),
        date_or_time => serde_json::Value::String(date_or_time.as_sql(true)),
    }
}

pub struct MariadbConnection {
    opts: Opts,
}

impl MariadbConnection {
    pub fn new(socket: &Path) -> Self {
        Self {
            opts: OptsBuilder::default()
                .socket(Some(socket.to_string_lossy().into_owned()))
                .user(Some(ADMIN_USER))
                .into(),
        }
    }

    async fn conn(&self) -> anyhow::Result<Conn> {
        Ok(Conn::new(self.opts.clone()).await?)
    }

    async fn execute(&self, sql: String) -> anyhow::Result<()> {
        let mut conn = self.conn().await?;
        conn.query_drop(sql).await?;
        conn.disconnect().await?;
        Ok(())
    }

    pub async fn create_user(&self, user: &UserIdentifier, password: &str) -> anyhow::Result<()> {
        self.execute(format!(
            "CREATE USER {}@'%' IDENTIFIED BY {}",
            quote_literal(&user.to_string()),
            quote_literal(password)
        ))
        .await
    }

    pub async fn update_user_password(
        &self,
        user: &UserIdentifier,
        password: &str,
    ) -> anyhow::Result<()> {
        self.execute(format!(
            "ALTER USER {}@'%' IDENTIFIED BY {}",
            quote_literal(&user.to_string()),
            quote_literal(password)
        ))
        .await
    }

    pub async fn delete_user(&self, user: &UserIdentifier) -> anyhow::Result<()> {
        self.execute(format!(
            "DROP USER IF EXISTS {}@'%'",
            quote_literal(&user.to_string())
        ))
        .await
    }

    pub async fn grant_user(&self, user: &UserIdentifier, database: &str) -> anyhow::Result<()> {
        self.execute(format!(
            "GRANT ALL PRIVILEGES ON {}.* TO {}@'%'",
            quote_ident(database),
            quote_literal(&user.to_string())
        ))
        .await
    }

    pub async fn create_database(&self, name: &str) -> anyhow::Result<()> {
        self.execute(format!("CREATE DATABASE {}", quote_ident(name)))
            .await
    }

    pub async fn delete_database(&self, name: &str) -> anyhow::Result<()> {
        self.execute(format!("DROP DATABASE IF EXISTS {}", quote_ident(name)))
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
        let mut conn = self.conn().await?;
        let size: Option<Option<i64>> =
            "SELECT CAST(SUM(data_length + index_length) AS SIGNED)
             FROM information_schema.tables WHERE table_schema = ?"
                .with((name,))
                .first(&mut conn)
                .await?;
        conn.disconnect().await?;

        Ok(size.flatten().unwrap_or_default())
    }

    pub async fn query(&self, database: Option<&str>, query: &str) -> anyhow::Result<QueryResult> {
        let mut conn = self.conn().await?;
        if let Some(database) = database {
            conn.query_drop(format!("USE {}", quote_ident(database)))
                .await?;
        }

        let mut query_result = conn.query_iter(query).await?;
        let mut result = QueryResult {
            columns: query_result
                .columns()
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|column| column.name_str().into_owned())
                .collect(),
            rows_affected: query_result.affected_rows(),
            rows: Vec::new(),
        };

        result.rows = query_result
            .collect::<Row>()
            .await?
            .into_iter()
            .map(|row| row.unwrap().into_iter().map(value_to_json).collect())
            .collect();

        drop(query_result);
        conn.disconnect().await?;

        Ok(result)
    }
}
