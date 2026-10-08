use super::{OrDatabaseFailure as _, OrStoreFailure as _};
use crate::state::Agent;
use crate::store::data;
use crate::utils::detached;
use database_agent_common::service::database::DatabaseService;
use database_agent_common::service::database::database_service_error::{
    CreateDatabaseError, DatabaseSizeError, DeleteDatabaseError, GetDatabaseError,
    ListDatabasesError, RecreateDatabaseError,
};
use database_agent_common::types::{StoredDatabase, validate_database_name};
use uuid::Uuid;
use zelus::async_trait;

#[async_trait]
impl DatabaseService for Agent {
    async fn list_databases(
        &self,
        instance_id: Uuid,
    ) -> Result<Vec<StoredDatabase>, ListDatabasesError> {
        self.instance(instance_id)
            .await
            .ok_or(ListDatabasesError::InstanceNotFound)?;

        data::databases(self.store.read(), instance_id)
            .await
            .or_store_failure("failed to list the databases")
    }

    async fn create_database(
        &self,
        instance_id: Uuid,
        name: String,
    ) -> Result<StoredDatabase, CreateDatabaseError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(CreateDatabaseError::InstanceNotFound)?;

        if !validate_database_name(&name) {
            return Err(CreateDatabaseError::DatabaseNameInvalid);
        }

        let taken = data::databases(self.store.read(), instance_id)
            .await
            .or_store_failure::<CreateDatabaseError>("failed to list the databases")?
            .iter()
            .any(|database| database.name == name);
        if taken {
            return Err(CreateDatabaseError::DatabaseNameTaken);
        }

        detached(async move { instance.create_database(&name).await })
            .await
            .or_database_failure("failed to create a database")
    }

    async fn get_database(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<StoredDatabase, GetDatabaseError> {
        self.instance(instance_id)
            .await
            .ok_or(GetDatabaseError::InstanceNotFound)?;

        data::database(self.store.read(), instance_id, database_id)
            .await
            .or_store_failure::<GetDatabaseError>("failed to read a database")?
            .ok_or(GetDatabaseError::DatabaseNotFound)
    }

    async fn delete_database(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<(), DeleteDatabaseError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(DeleteDatabaseError::InstanceNotFound)?;
        let database = data::database(self.store.read(), instance_id, database_id)
            .await
            .or_store_failure::<DeleteDatabaseError>("failed to read a database")?
            .ok_or(DeleteDatabaseError::DatabaseNotFound)?;

        detached(async move { instance.delete_database(&database).await })
            .await
            .or_database_failure("failed to delete a database")
    }

    async fn recreate_database(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<(), RecreateDatabaseError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(RecreateDatabaseError::InstanceNotFound)?;
        let database = data::database(self.store.read(), instance_id, database_id)
            .await
            .or_store_failure::<RecreateDatabaseError>("failed to read a database")?
            .ok_or(RecreateDatabaseError::DatabaseNotFound)?;

        instance
            .recreate_database(&database)
            .await
            .or_database_failure("failed to recreate a database")
    }

    async fn database_size(
        &self,
        instance_id: Uuid,
        database_id: Uuid,
    ) -> Result<i64, DatabaseSizeError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(DatabaseSizeError::InstanceNotFound)?;
        let database = data::database(self.store.read(), instance_id, database_id)
            .await
            .or_store_failure::<DatabaseSizeError>("failed to read a database")?
            .ok_or(DatabaseSizeError::DatabaseNotFound)?;

        instance
            .database_size(&database)
            .await
            .or_database_failure("failed to read a database size")
    }
}
