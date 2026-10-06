use super::{OrStoreFailure as _, OrUserFailure as _};
use crate::state::Agent;
use crate::store::data;
use database_agent_common::identifier::{LABEL_MAX_LENGTH, LABEL_MIN_LENGTH};
use database_agent_common::service::error_database_not_found::FromDatabaseNotFound;
use database_agent_common::service::error_store_failure::FromStoreFailure;
use database_agent_common::service::user::UserService;
use database_agent_common::service::user::user_service_error::{
    CreateUserError, DeleteUserError, GetUserError, ListUsersError, RotateUserPasswordError,
    SetUserGrantsError,
};
use database_agent_common::types::{StoredUser, UserGrant};
use std::collections::BTreeMap;
use uuid::Uuid;
use zelus::async_trait;

fn validate_username(username: &str) -> bool {
    (LABEL_MIN_LENGTH..=LABEL_MAX_LENGTH).contains(&username.len())
        && username.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

impl Agent {
    async fn resolve_grants<E>(
        &self,
        instance_id: Uuid,
        grants: Vec<UserGrant>,
    ) -> Result<Vec<UserGrant>, E>
    where
        E: FromStoreFailure + FromDatabaseNotFound,
    {
        let databases = data::databases(self.store.read(), instance_id)
            .await
            .or_store_failure::<E>("failed to list the databases")?;

        let mut resolved = BTreeMap::new();
        for grant in grants {
            if !databases
                .iter()
                .any(|database| database.uuid == grant.database_uuid)
            {
                return Err(<E as FromDatabaseNotFound>::from());
            }

            resolved.insert(grant.database_uuid, grant.access);
        }

        Ok(resolved
            .into_iter()
            .map(|(database_uuid, access)| UserGrant {
                database_uuid,
                access,
            })
            .collect())
    }
}

#[async_trait]
impl UserService for Agent {
    async fn list_users(&self, instance_id: Uuid) -> Result<Vec<StoredUser>, ListUsersError> {
        self.instance(instance_id)
            .await
            .ok_or(ListUsersError::InstanceNotFound)?;

        let mut store = self
            .store
            .read()
            .acquire()
            .await
            .map_err(anyhow::Error::from)
            .or_store_failure::<ListUsersError>("failed to read the store")?;
        data::users(&mut store, instance_id)
            .await
            .or_store_failure("failed to list the users")
    }

    async fn create_user(
        &self,
        instance_id: Uuid,
        username: String,
        grants: Vec<UserGrant>,
    ) -> Result<StoredUser, CreateUserError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(CreateUserError::InstanceNotFound)?;

        if !validate_username(&username) {
            return Err(CreateUserError::UserNameInvalid);
        }

        let grants = self
            .resolve_grants::<CreateUserError>(instance_id, grants)
            .await?;

        instance
            .create_user(&username, &grants)
            .await
            .or_user_failure("failed to create a user")
    }

    async fn get_user(&self, instance_id: Uuid, user_id: Uuid) -> Result<StoredUser, GetUserError> {
        self.instance(instance_id)
            .await
            .ok_or(GetUserError::InstanceNotFound)?;

        data::user(self.store.read(), instance_id, user_id)
            .await
            .or_store_failure::<GetUserError>("failed to read a user")?
            .ok_or(GetUserError::UserNotFound)
    }

    async fn set_user_grants(
        &self,
        instance_id: Uuid,
        user_id: Uuid,
        grants: Vec<UserGrant>,
    ) -> Result<StoredUser, SetUserGrantsError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(SetUserGrantsError::InstanceNotFound)?;
        let user = data::user(self.store.read(), instance_id, user_id)
            .await
            .or_store_failure::<SetUserGrantsError>("failed to read a user")?
            .ok_or(SetUserGrantsError::UserNotFound)?;

        let grants = self
            .resolve_grants::<SetUserGrantsError>(instance_id, grants)
            .await?;

        instance
            .set_grants(&user, &grants)
            .await
            .or_user_failure("failed to change a user's grants")
    }

    async fn delete_user(&self, instance_id: Uuid, user_id: Uuid) -> Result<(), DeleteUserError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(DeleteUserError::InstanceNotFound)?;
        let user = data::user(self.store.read(), instance_id, user_id)
            .await
            .or_store_failure::<DeleteUserError>("failed to read a user")?
            .ok_or(DeleteUserError::UserNotFound)?;

        instance
            .delete_user(&user)
            .await
            .or_user_failure("failed to delete a user")
    }

    async fn rotate_user_password(
        &self,
        instance_id: Uuid,
        user_id: Uuid,
    ) -> Result<String, RotateUserPasswordError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(RotateUserPasswordError::InstanceNotFound)?;
        let user = data::user(self.store.read(), instance_id, user_id)
            .await
            .or_store_failure::<RotateUserPasswordError>("failed to read a user")?
            .ok_or(RotateUserPasswordError::UserNotFound)?;

        instance
            .rotate_password(&user)
            .await
            .or_user_failure("failed to rotate a password")
    }
}
