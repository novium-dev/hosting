use crate::Backend;
use crate::db::server::{Server, ServerId};
use sqlx::{Executor, MySql, query, types::JsonValue};
use tracing::warn;

impl Backend {
    pub async fn resolve_server(
        &self,
        conn: impl Executor<'_, Database = MySql> + Copy,
        id: ServerId,
    ) -> Result<Option<Server>, sqlx::Error> {
        match query!(
            "SELECT
                        `id` AS `id: ServerId`,
                        `node` AS `node: uuid::fmt::Hyphenated`,
                        `node_server_id`,
                        `owner`,
                        `name`,
                        `group`,
                        `suspended` AS `suspended: bool`,
                        `custom_dockerfile`,
                        `internet_access` AS `internet_access: bool`,
                        `cpu`,
                        `ram`,
                        `swap`,
                        `disk`,
                        `backup_limit`,
                        `template`,
                        `template_extra` AS `template_extra: JsonValue`
                      FROM `servers` WHERE `id` = ?",
            id
        )
        .fetch_optional(conn)
        .await?
        {
            Some(server) => {
                let nodes = self.nodes.read().await;
                let Some(node) = nodes.get(server.node.as_uuid()).cloned() else {
                    warn!(
                        "Found server whose node is not in the nodes cache: {}, node: {}",
                        server.id, server.node
                    );
                    return Ok(None);
                };
                drop(nodes);

                let Some(template) = self.templates.read().await.get(&server.template).cloned()
                else {
                    warn!(
                        "Found server whose template is not registred: {}, template: {}",
                        server.id, server.template
                    );
                    return Ok(None);
                };

                Ok(Some(Server {
                    id: server.id,
                    name: server.name,
                    group: server.group,
                    suspended: server.suspended,
                    custom_dockerfile: server.custom_dockerfile,
                    internet_access: server.internet_access,

                    owner: server.owner,

                    node,
                    node_server_id: server.node_server_id,

                    template,
                    template_extra: server.template_extra,

                    cpu: server.cpu,
                    ram: server.ram,
                    swap: server.swap,
                    disk: server.disk,

                    backup_limit: server.backup_limit,
                }))
            }
            None => Ok(None),
        }
    }
}
