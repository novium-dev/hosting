use database_agent_common::types::QueryResult;
use redis::aio::MultiplexedConnection;
use redis::{Client, Value};
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
        Value::BigNumber(number) => serde_json::Value::String(number.to_string()),
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

pub struct RedisConnection {
    client: Client,
}

impl RedisConnection {
    pub fn new(socket: &Path) -> anyhow::Result<Self> {
        Ok(Self {
            client: Client::open(format!("unix://{}", socket.display()))?,
        })
    }

    async fn conn(&self) -> anyhow::Result<MultiplexedConnection> {
        Ok(self.client.get_multiplexed_async_connection().await?)
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
