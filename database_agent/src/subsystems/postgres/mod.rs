#![expect(
    clippy::big_endian_bytes,
    reason = "the wire protocol fixes the byte order, the integer widths and the encodings"
)]

mod protocol;
mod scram;

use crate::state::Agent;
use crate::utils::{SafeSliceExt as _, accept_loop, bad};
use core::net::SocketAddr;
use core::str::FromStr as _;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::DatabaseType;
use protocol::Params;
use std::io;
use tokio::io::{AsyncWriteExt as _, copy_bidirectional};
use tokio::net::{TcpListener, TcpStream, UnixStream};

const KIND: DatabaseType = DatabaseType::Postgres;
const INVALID_AUTHORIZATION: &str = "28P01";

pub async fn run(agent: Agent) -> anyhow::Result<()> {
    let bind = agent.config.subsystem(KIND).bind;
    let listener = TcpListener::bind(bind).await?;

    agent.subsystems.connections(KIND).mark_running();
    tracing::info!("postgres listening on {bind}");

    accept_loop(&listener, "postgres", |tcp, peer| {
        let agent = agent.clone();
        async move { session(tcp, &agent, peer).await }
    })
    .await
}

async fn negotiate(tcp: &mut TcpStream) -> io::Result<Params> {
    loop {
        let body = protocol::read_startup_body(tcp).await?;
        match protocol::startup_code(&body) {
            protocol::SSL_REQUEST | protocol::GSS_REQUEST => tcp.write_all(b"N").await?,
            protocol::PROTOCOL_30 => return Ok(protocol::parse_params(body.get_slice(4..)?)),
            other => return Err(bad(&format!("unsupported startup code {other}"))),
        }
    }
}

async fn session(mut stream: TcpStream, agent: &Agent, peer: SocketAddr) -> io::Result<()> {
    let params = negotiate(&mut stream).await?;

    let user = params.get("user").cloned().unwrap_or_default();
    let database = params
        .get("database")
        .cloned()
        .unwrap_or_else(|| user.clone());
    tracing::debug!("[{peer}] startup: user={user:?} database={database:?}");

    let identifier = UserIdentifier::from_str(&user).ok();
    let Some(credentials) = identifier.and_then(|id| agent.routes.find(KIND, &id)) else {
        scram::authenticate_client(&mut stream, None).await?;
        tracing::debug!("[{peer}] rejected: no credential for user {user:?}");
        return protocol::send_error(&mut stream, INVALID_AUTHORIZATION, "authentication failed")
            .await;
    };

    if !scram::authenticate_client(&mut stream, Some(&credentials.password)).await? {
        return protocol::send_error(&mut stream, INVALID_AUTHORIZATION, "authentication failed")
            .await;
    }

    if credentials.instance.is_suspended().await {
        tracing::debug!(
            "[{peer}] rejected: instance {} is suspended",
            credentials.instance.uuid
        );
        return protocol::send_error(
            &mut stream,
            INVALID_AUTHORIZATION,
            "the database is suspended",
        )
        .await;
    }
    protocol::write_msg(&mut stream, b'R', &0i32.to_be_bytes()).await?;
    tracing::info!("[{peer}] {user:?}@{database:?} authenticated");

    let mut backend = UnixStream::connect(&credentials.instance.socket_path().await).await?;
    protocol::send_startup(&mut backend, &params).await?;
    scram::authenticate_backend(&mut backend, &mut stream, &credentials.password).await?;

    let guard = identifier.map(|id| {
        agent
            .subsystems
            .connections(KIND)
            .connect(id, Some(database).filter(|name| !name.is_empty()))
    });
    let (sent, received) = copy_bidirectional(&mut stream, &mut backend).await?;
    drop(guard);

    tracing::debug!("[{peer}] closed (client {sent} B, backend {received} B)");

    Ok(())
}
