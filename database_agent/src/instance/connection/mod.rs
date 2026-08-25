pub mod mariadb;
pub mod mongodb;
pub mod postgres;
pub mod redis;

use crate::instance::Instance;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::{DatabaseAccess, DatabaseType, QueryResult};

fn unnamed_databases<T>() -> anyhow::Result<T> {
    anyhow::bail!("redis has no named databases")
}

#[derive(Debug, Clone)]
pub struct DatabaseGrant {
    pub user: UserIdentifier,
    pub access: DatabaseAccess,
}

pub enum Connection {
    Mariadb(mariadb::MariadbConnection),
    Mongodb(mongodb::MongodbConnection),
    Postgres(postgres::PostgresConnection),
    Redis(Box<redis::RedisConnection>),
}

impl Connection {
    pub async fn create_user(&self, user: &UserIdentifier, password: &str) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.create_user(user, password).await,
            Self::Mongodb(ref conn) => conn.create_user(user, password).await,
            Self::Postgres(ref conn) => conn.create_user(user, password).await,
            Self::Redis(_) => Ok(()),
        }
    }

    pub async fn update_user_password(
        &self,
        user: &UserIdentifier,
        password: &str,
    ) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.update_user_password(user, password).await,
            Self::Mongodb(ref conn) => conn.update_user_password(user, password).await,
            Self::Postgres(ref conn) => conn.update_user_password(user, password).await,
            Self::Redis(_) => Ok(()),
        }
    }

    pub async fn delete_user(
        &self,
        user: &UserIdentifier,
        databases: &[String],
    ) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.delete_user(user).await,
            Self::Mongodb(ref conn) => conn.delete_user(user).await,
            Self::Postgres(ref conn) => conn.delete_user(user, databases).await,
            Self::Redis(_) => Ok(()),
        }
    }

    /// Rewrites the engine privileges on `database` so that they match
    /// `grants`, stripping every privilege from `revoked` on the way.
    pub async fn sync_grants(
        &self,
        database: &str,
        grants: &[DatabaseGrant],
        revoked: &[UserIdentifier],
    ) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.sync_grants(database, grants, revoked).await,
            Self::Mongodb(ref conn) => conn.sync_grants(database, grants, revoked).await,
            Self::Postgres(ref conn) => conn.sync_grants(database, grants, revoked).await,
            Self::Redis(_) => Ok(()),
        }
    }

    pub async fn create_database(&self, name: &str) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.create_database(name).await,
            Self::Mongodb(_) => Ok(()),
            Self::Postgres(ref conn) => conn.create_database(name).await,
            Self::Redis(_) => unnamed_databases(),
        }
    }

    pub async fn delete_database(&self, name: &str) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.delete_database(name).await,
            Self::Mongodb(ref conn) => conn.delete_database(name).await,
            Self::Postgres(ref conn) => conn.delete_database(name).await,
            Self::Redis(_) => unnamed_databases(),
        }
    }

    pub async fn recreate_database(
        &self,
        name: &str,
        grants: &[DatabaseGrant],
    ) -> anyhow::Result<()> {
        match *self {
            Self::Mariadb(ref conn) => conn.recreate_database(name, grants).await,
            Self::Mongodb(ref conn) => conn.recreate_database(name).await,
            Self::Postgres(ref conn) => conn.recreate_database(name, grants).await,
            Self::Redis(_) => unnamed_databases(),
        }
    }

    pub async fn database_size(&self, name: &str) -> anyhow::Result<i64> {
        match *self {
            Self::Mariadb(ref conn) => conn.database_size(name).await,
            Self::Mongodb(ref conn) => conn.database_size(name).await,
            Self::Postgres(ref conn) => conn.database_size(name).await,
            Self::Redis(_) => unnamed_databases(),
        }
    }

    pub async fn query(&self, database: Option<&str>, query: &str) -> anyhow::Result<QueryResult> {
        match *self {
            Self::Mariadb(ref conn) => conn.query(database, query).await,
            Self::Mongodb(ref conn) => conn.query(database, query).await,
            Self::Postgres(ref conn) => conn.query(database, query).await,
            Self::Redis(ref conn) => conn.query(query).await,
        }
    }
}

impl Instance {
    pub async fn connection(&self) -> anyhow::Result<Connection> {
        let socket = self.socket_path().await;
        let kind = self.database_type().await;

        Ok(match kind {
            DatabaseType::Mariadb => Connection::Mariadb(mariadb::MariadbConnection::new(&socket)),
            DatabaseType::Mongodb => {
                self.ensure_mongodb_root().await?;
                let root_password = self.data.read().await.root_password.clone();
                Connection::Mongodb(mongodb::MongodbConnection::new(
                    socket,
                    root_password.as_deref(),
                )?)
            }
            DatabaseType::Postgres => {
                Connection::Postgres(postgres::PostgresConnection::new(socket))
            }
            DatabaseType::Redis => {
                Connection::Redis(Box::new(redis::RedisConnection::new(&socket)?))
            }
        })
    }
}
