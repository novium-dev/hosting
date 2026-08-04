#![expect(
    clippy::default_numeric_fallback,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

mod protocol;
mod scram;

use crate::state::Agent;
use crate::utils::{accept_loop, bad};
use bson::doc;
use core::net::SocketAddr;
use core::str::FromStr as _;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::DatabaseType;
use protocol::{
    OP_MSG, OP_QUERY, binary, hello_doc, op_msg_doc, read_message, sasl_error, write_op_msg,
    write_op_reply,
};
use scram::Session;
use std::io;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};

const KIND: DatabaseType = DatabaseType::Mongodb;

pub async fn run(agent: Agent) -> anyhow::Result<()> {
    let bind = agent.config.subsystem(KIND).bind;
    let listener = TcpListener::bind(bind).await?;

    agent.subsystems.connections(KIND).mark_running();
    tracing::info!("mongodb listening on {bind}");

    accept_loop(&listener, "mongodb", |tcp, peer| {
        let agent = agent.clone();
        async move { session(tcp, &agent, peer).await }
    })
    .await
}

async fn session(mut stream: TcpStream, agent: &Agent, peer: SocketAddr) -> io::Result<()> {
    let mut session: Option<Session> = None;

    loop {
        let (request_id, opcode, body) = read_message(&mut stream).await?;

        if opcode == OP_QUERY {
            write_op_reply(&mut stream, request_id, &hello_doc()).await?;
            continue;
        }
        if opcode != OP_MSG {
            return Err(bad("unsupported opcode"));
        }

        let message = op_msg_doc(&body).ok_or_else(|| bad("bad op_msg"))?;
        let command = message.keys().next().ok_or_else(|| bad("empty command"))?;

        match command.as_str() {
            "ismaster" | "isMaster" | "hello" => {
                write_op_msg(&mut stream, request_id, &hello_doc()).await?;
            }
            "saslStart" => {
                let payload = message
                    .get_binary_generic("payload")
                    .map_err(|_err| bad("no payload"))?;
                let database = message.get_str("$db").unwrap_or_default().to_owned();
                let client_first = String::from_utf8_lossy(payload).into_owned();
                let (bare, client_nonce, user) = scram::parse_client_first(&client_first)
                    .ok_or_else(|| bad("bad client-first"))?;
                tracing::debug!("[{peer}] saslStart user={user:?} database={database:?}");

                let credentials = UserIdentifier::from_str(&user)
                    .ok()
                    .and_then(|id| agent.routes.find(KIND, &id));
                let Some(credentials) = credentials else {
                    write_op_msg(
                        &mut stream,
                        request_id,
                        &sasl_error("authentication failed"),
                    )
                    .await?;
                    return Ok(());
                };

                if credentials.instance.is_suspended().await {
                    tracing::debug!(
                        "[{peer}] rejected: instance {} is suspended",
                        credentials.instance.uuid
                    );
                    write_op_msg(
                        &mut stream,
                        request_id,
                        &sasl_error("the database is suspended"),
                    )
                    .await?;
                    return Ok(());
                }

                if let Err(err) = credentials.instance.verify_mongodb_auth().await {
                    tracing::error!(
                        "[{peer}] rejected: instance {}: {err}",
                        credentials.instance.uuid
                    );
                    write_op_msg(
                        &mut stream,
                        request_id,
                        &sasl_error("the backend authorization is not verified"),
                    )
                    .await?;
                    return Ok(());
                }

                let (started, server_first) = Session::start(
                    &credentials.password,
                    &credentials.instance.socket_path().await,
                    bare,
                    &client_nonce,
                    user,
                    database,
                );

                write_op_msg(
                    &mut stream,
                    request_id,
                    &doc! {
                        "conversationId": 1,
                        "done": false,
                        "payload": binary(server_first.as_bytes()),
                        "ok": 1.0,
                    },
                )
                .await?;

                session = Some(started);
            }
            "saslContinue" => {
                let started = session
                    .as_ref()
                    .ok_or_else(|| bad("saslContinue before saslStart"))?;
                let payload = message
                    .get_binary_generic("payload")
                    .map_err(|_err| bad("no payload"))?;
                let client_final = String::from_utf8_lossy(payload).into_owned();

                let Some(server_final) = started.verify(&client_final) else {
                    write_op_msg(
                        &mut stream,
                        request_id,
                        &sasl_error("authentication failed"),
                    )
                    .await?;
                    return Ok(());
                };

                write_op_msg(
                    &mut stream,
                    request_id,
                    &doc! {
                        "conversationId": 1,
                        "done": true,
                        "payload": binary(server_final.as_bytes()),
                        "ok": 1.0,
                    },
                )
                .await?;
                break;
            }
            _ => {
                write_op_msg(&mut stream, request_id, &doc! { "ok": 1.0 }).await?;
            }
        }
    }

    let session = session.ok_or_else(|| bad("not authenticated"))?;
    tracing::info!(
        "[{peer}] {:?}@{:?} authenticated",
        session.user,
        session.database
    );

    let mut backend =
        scram::backend_auth(&session.socket, &session.user, &session.password).await?;

    let guard = UserIdentifier::from_str(&session.user).ok().map(|id| {
        agent
            .subsystems
            .connections(KIND)
            .connect(id, Some(session.database).filter(|name| !name.is_empty()))
    });
    let (sent, received) = copy_bidirectional(&mut stream, &mut backend).await?;
    drop(guard);

    tracing::debug!("[{peer}] closed (client {sent} B, backend {received} B)");

    Ok(())
}
