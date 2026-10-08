use super::{Check, CheckError};
use crate::state::Agent;
use database_agent_common::integrity::{
    IntegrityCategory, IntegrityFinding, IntegritySchema, IntegritySchemaTable,
};
use sqlx::{SqlitePool, query};
use zelus::async_trait;

pub async fn dump(pool: &SqlitePool) -> Result<IntegritySchema, sqlx::Error> {
    let tables = query!(
        r#"SELECT name AS "name!", sql AS "definition!" FROM sqlite_master
           WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name"#
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| IntegritySchemaTable {
        name: row.name,
        definition: row.definition,
    })
    .collect();

    Ok(IntegritySchema {
        engine: "sqlite".to_owned(),
        database: "store".to_owned(),
        tables,
    })
}

pub struct SchemaDump;

#[async_trait]
impl Check for SchemaDump {
    fn id(&self) -> &'static str {
        "schema"
    }

    fn title(&self) -> &'static str {
        "Agent store schema"
    }

    fn description(&self) -> &'static str {
        "Dumps the definition of every table and index in the agent's own SQLite store so a \
         developer can compare a host against the migrations it should have run."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Schema
    }

    async fn run(&self, agent: &Agent) -> Result<Vec<IntegrityFinding>, CheckError> {
        let schema = dump(agent.store.read()).await?;

        Ok(schema
            .tables
            .into_iter()
            .map(|table| {
                IntegrityFinding::info(format!("Definition of {}", table.name))
                    .with_subject(table.name)
                    .with_detail("definition", table.definition)
            })
            .collect())
    }
}
