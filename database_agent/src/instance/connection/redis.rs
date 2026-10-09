use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::QueryResult;
use redis::aio::MultiplexedConnection;
use redis::{Client, ConnectionAddr, IntoConnectionInfo as _, RedisConnectionInfo, Value};
use std::path::Path;

fn value_to_json(value: Value) -> serde_json::Value {
    match value {
        Value::Nil => serde_json::Value::Null,
        Value::Int(number) => number.into(),
        Value::Double(number) => serde_json::json!(number),
        Value::Boolean(boolean) => boolean.into(),
        Value::BulkString(bytes) => {
            serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
        }
        Value::SimpleString(string) => serde_json::Value::String(string),
        Value::VerbatimString { text, .. } => serde_json::Value::String(text),
        Value::Okay => serde_json::Value::String("OK".to_owned()),
        Value::Array(values) | Value::Set(values) => {
            serde_json::Value::Array(values.into_iter().map(value_to_json).collect())
        }
        Value::Map(pairs) => serde_json::Value::Array(
            pairs
                .into_iter()
                .map(|(key, value)| serde_json::json!([value_to_json(key), value_to_json(value)]))
                .collect(),
        ),
        other => serde_json::Value::String(format!("{other:?}")),
    }
}

pub const ROOT_USERNAME: &str = "default";
const USER_PERMISSIONS: &[&str] = &["~*", "&*", "+@all", "-@admin"];

pub struct RedisConnection {
    client: Client,
    online: bool,
}

impl RedisConnection {
    pub fn new(socket: &Path, root_password: &str, online: bool) -> anyhow::Result<Self> {
        let info = ConnectionAddr::Unix(socket.to_path_buf())
            .into_connection_info()?
            .set_redis_settings(
                RedisConnectionInfo::default()
                    .set_username(ROOT_USERNAME)
                    .set_password(root_password),
            );

        Ok(Self {
            client: Client::open(info)?,
            online,
        })
    }

    async fn conn(&self) -> anyhow::Result<MultiplexedConnection> {
        Ok(self.client.get_multiplexed_async_connection().await?)
    }

    pub async fn secure(&self, root_password: &str) -> anyhow::Result<()> {
        redis::cmd("ACL")
            .arg("SETUSER")
            .arg(ROOT_USERNAME)
            .arg("on")
            .arg("resetpass")
            .arg(format!(">{root_password}"))
            .arg(&["~*", "&*", "+@all"])
            .exec_async(&mut self.conn().await?)
            .await?;

        Ok(())
    }

    pub async fn create_user(&self, user: &UserIdentifier, password: &str) -> anyhow::Result<()> {
        if !self.online {
            return Ok(());
        }

        redis::cmd("ACL")
            .arg("SETUSER")
            .arg(user.to_string())
            .arg("reset")
            .arg("on")
            .arg(format!(">{password}"))
            .arg(USER_PERMISSIONS)
            .exec_async(&mut self.conn().await?)
            .await?;

        Ok(())
    }

    pub async fn delete_user(&self, user: &UserIdentifier) -> anyhow::Result<()> {
        if !self.online {
            return Ok(());
        }

        redis::cmd("ACL")
            .arg("DELUSER")
            .arg(user.to_string())
            .exec_async(&mut self.conn().await?)
            .await?;

        Ok(())
    }

    pub async fn query(&self, query: &str) -> anyhow::Result<QueryResult> {
        let mut parts = query.split_whitespace();
        let Some(name) = parts.next() else {
            anyhow::bail!("empty command")
        };

        let mut command = redis::cmd(name);
        for argument in parts {
            command.arg(argument);
        }

        let value: Value = command.query_async(&mut self.conn().await?).await?;
        let rows = match value_to_json(value) {
            serde_json::Value::Array(values) => {
                values.into_iter().map(|value| vec![value]).collect()
            }
            value => vec![vec![value]],
        };

        Ok(QueryResult {
            columns: vec!["reply".to_owned()],
            rows,
            rows_affected: 0,
        })
    }
}
