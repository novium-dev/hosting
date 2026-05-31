
use super::*;
use zelus::service;
use crate::auth::Authentication;
use crate::auth::permissions::{ServerPermissions};
use crate::Backend;
use crate::db::server::ServerId;
use crate::service::minecraft::minecraft_service_error::BanUserError;

#[service(path = "/minecraft", tag = "minecraft", no_sdk)]
pub(crate) impl MinecraftService for Backend {
    #[route("/{server_id}/ban", method = GET, raw)]
    #[error(auth::{permission_denied, unreachable}, db::failure <- [sql:*], cache::failure <- [redis:*], server::{not_found, unavailable}, node::failure)]
    async fn ban_user(
        &self,
        #[special] auth: Authentication,
        server_id: ServerId,
        user: String
    ) -> Result<(), _> {
        auth.require::<_, _, BanUserError>(server_id, ServerPermissions::TERMINAL_WRITE)?;

        self.execute_rcon::<BanUserError>(server_id, vec!["ban".to_string(), user]).await?;

        Ok(())
    }
}