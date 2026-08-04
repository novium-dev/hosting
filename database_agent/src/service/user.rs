use super::{OrStoreFailure as _, OrUserFailure as _};
use crate::state::Agent;
use crate::store::data;
use database_agent_common::identifier::{LABEL_MAX_LENGTH, LABEL_MIN_LENGTH};
use database_agent_common::service::user::UserService;
use database_agent_common::service::user::user_service_error::{
    CreateUserError, DeleteUserError, GetUserError, ListUsersError, RotateUserPasswordError,
};
use database_agent_common::types::StoredUser;
use uuid::Uuid;
use zelus::async_trait;

fn validate_username(username: &str) -> bool {
    (LABEL_MIN_LENGTH..=LABEL_MAX_LENGTH).contains(&username.len())
        && username.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[async_trait]
impl UserService for Agent {
    async fn list_users(&self, instance_id: Uuid) -> Result<Vec<StoredUser>, ListUsersError> {
        self.instance(instance_id)
            .await
            .ok_or(ListUsersError::InstanceNotFound)?;

        data::users(self.store.read(), instance_id)
            .await
            .or_store_failure("failed to list the users")
    }

    async fn create_user(
        &self,
        instance_id: Uuid,
        username: String,
        database_id: Option<Uuid>,
    ) -> Result<StoredUser, CreateUserError> {
        let instance = self
            .instance(instance_id)
            .await
            .ok_or(CreateUserError::InstanceNotFound)?;

        if !validate_username(&username) {
            return Err(CreateUserError::UserNameInvalid);
        }

        let database = match database_id {
            Some(database_id) => Some(
                data::database(self.store.read(), instance_id, database_id)
                    .await
                    .or_store_failure::<CreateUserError>("failed to read a database")?
                    .ok_or(CreateUserError::DatabaseNotFound)?,
            ),
            None => None,
        };

        instance
            .create_user(&username, database.as_ref())
            .await
            .or_user_failure("failed to create a user")
    }

    async fn get_user(
        &self,
        instance_id: Uuid,
        user_id: Uuid,
    ) -> Result<StoredUser, GetUserError> {
        self.instance(instance_id)
            .await
            .ok_or(GetUserError::InstanceNotFound)?;

        data::user(self.store.read(), instance_id, user_id)
            .await
            .or_store_failure::<GetUserError>("failed to read a user")?
            .ok_or(GetUserError::UserNotFound)
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
