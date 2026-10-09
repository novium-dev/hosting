mod resp;

use crate::state::Agent;
use crate::utils::{accept_loop, constant_time_eq};
use core::net::SocketAddr;
use core::str::FromStr as _;
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::DatabaseType;
use std::io;
use tokio::io::{AsyncWriteExt as _, copy_bidirectional};
use tokio::net::{TcpListener, TcpStream, UnixStream};

const KIND: DatabaseType = DatabaseType::Redis;
const WRONG_PASS: &[u8] = b"-WRONGPASS invalid username-password pair or user is disabled.\r\n";

pub async fn run(agent: Agent) -> anyhow::Result<()> {
    let bind = agent.config.subsystem(KIND).bind;
    let listener = TcpListener::bind(bind).await?;

    agent.subsystems.connections(KIND).mark_running();
    tracing::info!("redis listening on {bind}");

    accept_loop(&listener, "redis", |tcp, peer| {
        let agent = agent.clone();
        async move { session(tcp, &agent, peer).await }
    })
    .await
}

struct Identity {
    user: String,
    password: Vec<u8>,
    forward: Option<Vec<u8>>,
}

async fn identify<S: tokio::io::AsyncWrite + Unpin>(
    stream: &mut S,
    arguments: &[Vec<u8>],
    peer: SocketAddr,
) -> io::Result<Option<Identity>> {
    let Some(first) = arguments.first() else {
        return Ok(None);
    };

    match String::from_utf8_lossy(first).to_ascii_uppercase().as_str() {
        "AUTH" => {
            let (user, password) = match *arguments {
                [_, ref user, ref password, ..] => {
                    (String::from_utf8_lossy(user).into_owned(), password.clone())
                }
                [_, ref password] => ("default".to_owned(), password.clone()),
                _ => {
                    stream
                        .write_all(b"-ERR wrong number of arguments for 'auth' command\r\n")
                        .await?;
                    return Ok(None);
                }
            };

            Ok(Some(Identity {
                user,
                password,
                forward: None,
            }))
        }
        "HELLO" => Ok(Some(Identity {
            user: resp::hello_user(arguments).unwrap_or_else(|| "default".to_owned()),
            password: resp::hello_password(arguments).unwrap_or_default(),
            forward: Some(resp::encode_command(&resp::strip_hello_auth(arguments))),
        })),
        other => {
            tracing::debug!("[{peer}] the first command {other:?} carries no identity");
            Ok(None)
        }
    }
}

async fn session(mut stream: TcpStream, agent: &Agent, peer: SocketAddr) -> io::Result<()> {
    let Some(arguments) = resp::read_command(&mut stream)
        .await?
        .filter(|arguments| !arguments.is_empty())
    else {
        tracing::debug!("[{peer}] no parseable command");
        return Ok(());
    };

    let Some(identity) = identify(&mut stream, &arguments, peer).await? else {
        return Ok(());
    };

    let user_id = UserIdentifier::from_str(&identity.user).ok();
    let credentials = user_id
        .and_then(|id| agent.routes.find(KIND, &id))
        .filter(|candidate| constant_time_eq(&identity.password, candidate.password.as_bytes()));

    let Some(credentials) = credentials else {
        tracing::debug!("[{peer}] rejected the auth for user {:?}", identity.user);
        return stream.write_all(WRONG_PASS).await;
    };

    if credentials.instance.is_suspended().await {
        tracing::debug!(
            "[{peer}] rejected: instance {} is suspended",
            credentials.instance.uuid
        );
        return stream
            .write_all(b"-ERR the database is suspended\r\n")
            .await;
    }

    let mut backend = UnixStream::connect(&credentials.instance.socket_path().await).await?;

    let Some(user_id) = user_id else {
        return stream.write_all(WRONG_PASS).await;
    };
    backend
        .write_all(&resp::encode_command(&[
            b"AUTH".to_vec(),
            user_id.to_string().into_bytes(),
            credentials.password.as_bytes().to_vec(),
        ]))
        .await?;
    let reply = resp::read_reply_line(&mut backend).await?;
    if reply.first() != Some(&b'+') {
        tracing::warn!(
            "[{peer}] the instance {} refused the credentials of {user_id}",
            credentials.instance.uuid
        );
        return stream.write_all(WRONG_PASS).await;
    }

    match identity.forward {
        Some(bytes) => backend.write_all(&bytes).await?,
        None => stream.write_all(b"+OK\r\n").await?,
    }

    let guard = agent.subsystems.connections(KIND).connect(user_id, None);
    let (sent, received) = copy_bidirectional(&mut stream, &mut backend).await?;
    drop(guard);

    tracing::debug!("[{peer}] closed (client {sent} B, backend {received} B)");

    Ok(())
}
