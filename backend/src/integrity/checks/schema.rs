use crate::Backend;
use crate::integrity::{Check, CheckError};
use core::fmt::Write as _;
use daemon_common::integrity::{
    IntegrityCategory, IntegrityFinding, IntegritySchema, IntegritySchemaTable,
};
use sqlx::{PgPool, Row as _, query, query_scalar};
use std::collections::BTreeMap;

struct Column {
    name: String,
    kind: String,
    not_null: bool,
    default: Option<String>,
}

pub(crate) async fn dump(pool: &PgPool) -> Result<IntegritySchema, sqlx::Error> {
    let database: String = query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await?;

    let mut columns: BTreeMap<String, Vec<Column>> = BTreeMap::new();
    for row in query(
        "SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                pg_get_expr(d.adbin, d.adrelid)
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE c.relkind = 'r' AND n.nspname = 'public'
         ORDER BY c.relname, a.attnum",
    )
    .fetch_all(pool)
    .await?
    {
        let (Ok(table), Ok(name), Ok(kind), Ok(not_null)) = (
            row.try_get::<String, _>(0usize),
            row.try_get::<String, _>(1usize),
            row.try_get::<String, _>(2usize),
            row.try_get::<bool, _>(3usize),
        ) else {
            continue;
        };
        columns.entry(table).or_default().push(Column {
            name,
            kind,
            not_null,
            default: row.try_get::<Option<String>, _>(4usize).unwrap_or(None),
        });
    }

    let mut constraints: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in query(
        "SELECT c.relname, con.conname, pg_get_constraintdef(con.oid)
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
         ORDER BY c.relname, con.conname",
    )
    .fetch_all(pool)
    .await?
    {
        let (Ok(table), Ok(name), Ok(definition)) = (
            row.try_get::<String, _>(0usize),
            row.try_get::<String, _>(1usize),
            row.try_get::<String, _>(2usize),
        ) else {
            continue;
        };
        constraints
            .entry(table)
            .or_default()
            .push(format!("CONSTRAINT {name} {definition}"));
    }

    let mut indexes: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in query(
        "SELECT tablename, indexdef FROM pg_indexes
         WHERE schemaname = 'public' ORDER BY tablename, indexname",
    )
    .fetch_all(pool)
    .await?
    {
        let (Ok(table), Ok(definition)) = (
            row.try_get::<String, _>(0usize),
            row.try_get::<String, _>(1usize),
        ) else {
            continue;
        };
        indexes.entry(table).or_default().push(definition);
    }

    let tables = columns
        .into_iter()
        .map(|(table, table_columns)| {
            let definition = render(
                &table,
                &table_columns,
                constraints.get(&table).map_or(&[][..], Vec::as_slice),
                indexes.get(&table).map_or(&[][..], Vec::as_slice),
            );
            IntegritySchemaTable {
                name: table,
                definition,
            }
        })
        .collect();

    Ok(IntegritySchema {
        engine: "postgres".to_owned(),
        database,
        tables,
    })
}

fn render(table: &str, columns: &[Column], constraints: &[String], indexes: &[String]) -> String {
    let mut parts: Vec<String> = columns
        .iter()
        .map(|column| {
            let mut line = format!("    {} {}", column.name, column.kind);
            if let Some(ref default) = column.default {
                let _ = write!(line, " DEFAULT {default}");
            }
            if column.not_null {
                line.push_str(" NOT NULL");
            }
            line
        })
        .collect();
    parts.extend(
        constraints
            .iter()
            .map(|constraint| format!("    {constraint}")),
    );

    let mut out = format!("CREATE TABLE {table} (\n{}\n);", parts.join(",\n"));
    for index in indexes {
        let _ = write!(out, "\n{index};");
    }
    out
}

pub(crate) struct SchemaDump;

#[async_trait::async_trait]
impl Check for SchemaDump {
    fn id(&self) -> &'static str {
        "schema"
    }

    fn title(&self) -> &'static str {
        "Backend database schema"
    }

    fn description(&self) -> &'static str {
        "Renders the definition of every table in the backend database, together with its \
         constraints and indexes, so a developer can compare a deployment against the migrations \
         it should have run."
    }

    fn category(&self) -> IntegrityCategory {
        IntegrityCategory::Schema
    }

    async fn run(&self, backend: &Backend) -> Result<Vec<IntegrityFinding>, CheckError> {
        let schema = dump(&backend.database).await?;

        Ok(schema
            .tables
            .into_iter()
            .map(|table| {
                IntegrityFinding::info(format!("Table {} of {}", table.name, schema.database))
                    .with_subject(table.name)
                    .with_detail("definition", table.definition)
            })
            .collect())
    }
}
