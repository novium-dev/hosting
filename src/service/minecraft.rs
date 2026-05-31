use super::*;
use crate::Backend;
use crate::auth::Authentication;
use crate::auth::permissions::ServerPermissions;
use crate::db::server::ServerId;
use crate::service::minecraft::minecraft_service_error::{BanUserError, DeopUserError, OpUserError, PardonUserError};
use zelus::service;

#[service(path = "/minecraft", tag = "minecraft", no_sdk)]
pub(crate) impl MinecraftService for Backend {
    #[route("/{server_id}/ban", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, unavailable}, node::failure)]
    async fn ban_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        user: String,
    ) -> Result<(), _> {
        auth.require::<_, _, BanUserError>(server_id, ServerPermissions::TERMINAL_WRITE)?;

        self.execute_rcon::<BanUserError>(server_id, vec!["ban".to_owned(), user])
            .await?;

        Ok(())
    }

    #[route("/{server_id}/pardon", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, unavailable}, node::failure)]
    async fn pardon_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        user: String,
    ) -> Result<(), _> {
        auth.require::<_, _, PardonUserError>(server_id, ServerPermissions::TERMINAL_WRITE)?;

        self.execute_rcon::<PardonUserError>(server_id, vec!["pardon".to_owned(), user])
            .await?;

        Ok(())
    }

    #[route("/{server_id}/op", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, unavailable}, node::failure)]
    async fn op_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        user: String,
    ) -> Result<(), _> {
        auth.require::<_, _, OpUserError>(server_id, ServerPermissions::TERMINAL_WRITE)?;

        self.execute_rcon::<OpUserError>(server_id, vec!["op".to_owned(), user])
            .await?;

        Ok(())
    }

    #[route("/{server_id}/deop", method = GET)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, unavailable}, node::failure)]
    async fn deop_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        user: String,
    ) -> Result<(), _> {
        auth.require::<_, _, DeopUserError>(server_id, ServerPermissions::TERMINAL_WRITE)?;

        self.execute_rcon::<DeopUserError>(server_id, vec!["deop".to_owned(), user])
            .await?;

        Ok(())
    }
}
