use crate::Backend;
use crate::db::project::ProjectId;
use crate::db::server::{Server, ServerId};
use sqlx::{Executor, Postgres, query, types::JsonValue};
use tracing::warn;

impl Backend {
    pub async fn resolve_server(
        &self,
        conn: impl Executor<'_, Database = Postgres>,
        id: ServerId,
    ) -> Result<Option<Server>, sqlx::Error> {
        match query!(
            r#"SELECT
                        id AS "id: ServerId",
                        node,
                        node_server_id,
                        project AS "project: ProjectId",
                        name,
                        suspended AS "suspended: bool",
                        custom_dockerfile,
                        internet_access AS "internet_access: bool",
                        cpu,
                        ram,
                        swap,
                        disk,
                        backup_limit,
                        template,
                        template_extra AS "template_extra: JsonValue"
                      FROM servers WHERE id = $1"#,
            id.as_str()
        )
        .fetch_optional(conn)
        .await?
        {
            Some(server) => {
                let nodes = self.nodes.read().await;
                let Some(node) = nodes.get(&server.node).cloned() else {
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
                    suspended: server.suspended,
                    custom_dockerfile: server.custom_dockerfile,
                    internet_access: server.internet_access,

                    project: server.project,

                    node,
                    node_server_id: server.node_server_id as u32,

                    template,
                    template_extra: server.template_extra,

                    cpu: server.cpu,
                    ram: server.ram.map(|value| value as u32),
                    swap: server.swap.map(|value| value as u32),
                    disk: server.disk.map(|value| value as u64),

                    backup_limit: server.backup_limit.map(|value| value as u32),
                }))
            }
            None => Ok(None),
        }
    }
}
