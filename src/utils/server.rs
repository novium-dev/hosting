use crate::Backend;
use crate::db::server::{Server, ServerId};
use sqlx::{Executor, MySql, Row as _, query, types::JsonValue};
use tracing::warn;

impl Backend {
    pub async fn resolve_server(
        &self,
        conn: impl Executor<'_, Database = MySql>,
        id: ServerId,
    ) -> Result<Option<Server>, sqlx::Error> {
        match query(
            "SELECT
                `node`,
                `node_server_id`,
                `owner`,
                `name`,
                `group`,
                `suspended`,
                `custom_dockerfile`,
                `internet_access`,
                `cpu`,
                `ram`,
                `swap`,
                `disk`,
                `backup_limit`,
                `template`,
                `template_extra`
            FROM `servers` WHERE `id` = ?",
        )
        .bind(id)
        .fetch_optional(conn)
        .await?
        {
            Some(server) => {
                let node_id: uuid::Uuid = server.try_get("node")?;
                let nodes = self.nodes.read().await;
                let Some(node) = nodes.get(&node_id).cloned() else {
                    warn!(
                        "Found server whose node is not in the nodes cache: {}, node: {}",
                        id, node_id
                    );
                    return Ok(None);
                };
                drop(nodes);

                let template_id: String = server.try_get("template")?;
                let Some(template) = self.templates.read().await.get(&template_id).cloned() else {
                    warn!(
                        "Found server whose template is not registred: {}, template: {}",
                        id, template_id
                    );
                    return Ok(None);
                };

                Ok(Some(Server {
                    id,
                    name: server.try_get("name")?,
                    group: server.try_get("group")?,
                    suspended: server.try_get("suspended")?,
                    custom_dockerfile: server.try_get("custom_dockerfile")?,
                    internet_access: server.try_get("internet_access")?,
                    owner: server.try_get("owner")?,
                    node,
                    node_server_id: server.try_get("node_server_id")?,
                    template,
                    template_extra: server.try_get::<JsonValue, _>("template_extra")?,
                    cpu: server.try_get("cpu")?,
                    ram: server.try_get("ram")?,
                    swap: server.try_get("swap")?,
                    disk: server.try_get("disk")?,
                    backup_limit: server.try_get("backup_limit")?,
                }))
            }
            None => Ok(None),
        }
    }
}
