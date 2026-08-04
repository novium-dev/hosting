#![expect(
    clippy::big_endian_bytes,
    clippy::little_endian_bytes,
    clippy::default_numeric_fallback,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

mod auth;
mod protocol;

use crate::state::Agent;
use crate::utils::{SafeSliceExt as _, accept_loop, bad};
use core::net::SocketAddr;
use core::str::FromStr as _;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::DatabaseType;
use protocol::{read_packet, write_packet};
use rand::Rng as _;
use std::io;
use std::path::Path;
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream, UnixStream};

const KIND: DatabaseType = DatabaseType::Mariadb;
const ACCESS_DENIED: u16 = 1045;
const SQLSTATE_INVALID_AUTHORIZATION: &str = "28000";

pub async fn run(agent: Agent) -> anyhow::Result<()> {
    let bind = agent.config.subsystem(KIND).bind;
    let listener = TcpListener::bind(bind).await?;

    agent.subsystems.connections(KIND).mark_running();
    tracing::info!("mariadb listening on {bind}");

    accept_loop(&listener, "mariadb", |tcp, peer| {
        let agent = agent.clone();
        async move { session(tcp, &agent, peer).await }
    })
    .await
}

async fn session(mut stream: TcpStream, agent: &Agent, peer: SocketAddr) -> io::Result<()> {
    let mut scramble = [0; 20];
    rand::rng().fill_bytes(&mut scramble);
    write_packet(&mut stream, 0, &protocol::server_handshake(&scramble)?).await?;

    let (client_sequence, packet) = read_packet(&mut stream).await?;
    let handshake = protocol::parse_handshake_response(&packet)?;
    tracing::debug!(
        "[{peer}] handshake: user={:?} database={:?} plugin={:?}",
        handshake.user,
        handshake.database,
        handshake.plugin
    );

    let identifier = UserIdentifier::from_str(&handshake.user).ok();
    let Some(credentials) = identifier.and_then(|id| agent.routes.find(KIND, &id)) else {
        return write_packet(
            &mut stream,
            client_sequence.wrapping_add(1),
            &protocol::err_packet(
                ACCESS_DENIED,
                SQLSTATE_INVALID_AUTHORIZATION,
                &format!("no credential for user {:?}", handshake.user),
            ),
        )
        .await;
    };

    if credentials.instance.is_suspended().await {
        tracing::debug!(
            "[{peer}] rejected: instance {} is suspended",
            credentials.instance.uuid
        );
        return write_packet(
            &mut stream,
            client_sequence.wrapping_add(1),
            &protocol::err_packet(
                ACCESS_DENIED,
                SQLSTATE_INVALID_AUTHORIZATION,
                "the database is suspended",
            ),
        )
        .await;
    }

    let (mut token, mut sequence) = (handshake.auth_response, client_sequence);
    if handshake.plugin != protocol::NATIVE {
        write_packet(
            &mut stream,
            sequence.wrapping_add(1),
            &protocol::auth_switch_request(&scramble),
        )
        .await?;
        let (switched_sequence, switched_token) = read_packet(&mut stream).await?;
        token = switched_token;
        sequence = switched_sequence;
    }

    if !constant_time_eq::constant_time_eq(
        &token,
        &auth::native_token(&scramble, credentials.password.as_bytes()),
    ) {
        return write_packet(
            &mut stream,
            sequence.wrapping_add(1),
            &protocol::err_packet(
                ACCESS_DENIED,
                SQLSTATE_INVALID_AUTHORIZATION,
                "access denied",
            ),
        )
        .await;
    }

    write_packet(
        &mut stream,
        sequence.wrapping_add(1),
        &protocol::ok_packet(),
    )
    .await?;
    tracing::info!(
        "[{peer}] {:?}@{:?} authenticated",
        handshake.user,
        handshake.database
    );

    let mut backend = backend_auth(
        &credentials.instance.socket_path().await,
        &handshake.user,
        &credentials.password,
        &handshake.database,
        handshake.caps,
    )
    .await?;

    let guard = identifier.map(|id| {
        agent
            .subsystems
            .connections(KIND)
            .connect(id, Some(handshake.database).filter(|name| !name.is_empty()))
    });
    let (sent, received) = copy_bidirectional(&mut stream, &mut backend).await?;
    drop(guard);

    tracing::debug!("[{peer}] closed (client {sent} B, backend {received} B)");

    Ok(())
}

async fn backend_auth(
    socket: &Path,
    user: &str,
    password: &str,
    database: &str,
    client_caps: u32,
) -> io::Result<UnixStream> {
    let mut backend = UnixStream::connect(socket).await?;

    let (sequence, handshake) = read_packet(&mut backend).await?;
    let scramble = protocol::parse_server_handshake(&handshake)?;
    let token = auth::native_token(&scramble, password.as_bytes());

    write_packet(
        &mut backend,
        sequence.wrapping_add(1),
        &protocol::handshake_response(user, &token, database, client_caps),
    )
    .await?;

    loop {
        let (sequence, packet) = read_packet(&mut backend).await?;
        match packet.first() {
            Some(&0x00) => return Ok(backend),
            Some(&0xff) => {
                let message = if packet.len() > 9 {
                    String::from_utf8_lossy(packet.get_slice(9..)?).into_owned()
                } else {
                    "backend error".to_owned()
                };
                return Err(bad(&format!("the backend refused the auth: {message}")));
            }
            Some(&0xfe) => {
                let mut cursor = 1;
                protocol::read_cstr(&packet, &mut cursor)?;

                let mut scramble = [0; 20];
                let available = packet.len().saturating_sub(cursor).min(20);
                scramble
                    .get_mut(..available)
                    .ok_or_else(|| bad("short backend scramble"))?
                    .copy_from_slice(
                        packet.get_slice(cursor..cursor.saturating_add(available))?,
                    );

                let token = auth::native_token(&scramble, password.as_bytes());
                write_packet(&mut backend, sequence.wrapping_add(1), &token).await?;
            }
            _ => return Err(bad("unexpected backend auth packet")),
        }
    }
}
