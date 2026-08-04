#![expect(
    clippy::big_endian_bytes,
    clippy::little_endian_bytes,
    clippy::default_numeric_fallback,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

use super::protocol::{read_msg, write_msg};
use crate::subsystems::scram;
use crate::utils::{SafeArrayExt as _, SafeSliceExt as _, bad};
use postgres_protocol::authentication::sasl::{ChannelBinding, ScramSha256};
use postgres_protocol::message::frontend::{
    password_message, sasl_initial_response, sasl_response,
};
use std::io;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt as _};

const SCRAM_ITERATIONS: u32 = 4096;

const AUTHENTICATION_OK: i32 = 0;
const AUTHENTICATION_CLEARTEXT: i32 = 3;
const AUTHENTICATION_MD5: i32 = 5;
const AUTHENTICATION_SASL: i32 = 10;
const AUTHENTICATION_SASL_CONTINUE: i32 = 11;
const AUTHENTICATION_SASL_FINAL: i32 = 12;

pub async fn authenticate_client<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    password: &str,
) -> io::Result<bool> {
    let mut advertisement = AUTHENTICATION_SASL.to_be_bytes().to_vec();
    advertisement.extend_from_slice(b"SCRAM-SHA-256\0\0");
    write_msg(stream, b'R', &advertisement).await?;

    let (tag, body) = read_msg(stream).await?;
    if tag != b'p' {
        return Err(bad("expected a sasl initial response"));
    }

    let mechanism_end = body
        .iter()
        .position(|&byte| byte == 0)
        .ok_or_else(|| bad("no sasl mechanism"))?;
    let client_first =
        String::from_utf8_lossy(body.get_slice(mechanism_end.saturating_add(5)..)?).into_owned();
    let client_first_bare = scram::bare_after_gs2(&client_first)
        .ok_or_else(|| bad("malformed client-first"))?
        .to_owned();
    let client_nonce =
        scram::field(&client_first_bare, "r=").ok_or_else(|| bad("no client nonce"))?;

    let server_nonce = scram::encode(&scram::random_bytes::<{ scram::NONCE_LENGTH }>());
    let salt = scram::random_bytes::<{ scram::SALT_LENGTH }>();
    let server_first = format!(
        "r={client_nonce}{server_nonce},s={},i={SCRAM_ITERATIONS}",
        scram::encode(&salt)
    );

    let mut challenge = AUTHENTICATION_SASL_CONTINUE.to_be_bytes().to_vec();
    challenge.extend_from_slice(server_first.as_bytes());
    write_msg(stream, b'R', &challenge).await?;

    let (tag, body) = read_msg(stream).await?;
    if tag != b'p' {
        return Err(bad("expected a sasl response"));
    }

    let client_final = String::from_utf8_lossy(&body).into_owned();
    let Some(proof) = scram::field(&client_final, "p=") else {
        return Err(bad("no client proof"));
    };
    let Some(without_proof) = client_final.rsplit_once(",p=").map(|(head, _)| head) else {
        return Err(bad("malformed client-final"));
    };

    let salted = scram::pbkdf2_sha256(password.as_bytes(), &salt, SCRAM_ITERATIONS);
    let auth_message = format!("{client_first_bare},{server_first},{without_proof}");
    let (_, expected) = scram::client_proof(&salted, &auth_message);

    let Some(given) = scram::decode(&proof) else {
        return Err(bad("malformed client proof"));
    };
    if !constant_time_eq::constant_time_eq(&expected, &given) {
        return Ok(false);
    }

    let mut final_message = AUTHENTICATION_SASL_FINAL.to_be_bytes().to_vec();
    final_message.extend_from_slice(
        format!("v={}", scram::server_signature(&salted, &auth_message)).as_bytes(),
    );
    write_msg(stream, b'R', &final_message).await?;

    Ok(true)
}

pub async fn authenticate_backend<
    B: AsyncRead + AsyncWrite + Unpin,
    S: AsyncRead + AsyncWrite + Unpin,
>(
    backend: &mut B,
    client: &mut S,
    password: &str,
) -> io::Result<()> {
    let mut session: Option<ScramSha256> = None;

    loop {
        let (tag, body) = read_msg(backend).await?;
        match tag {
            b'R' => match i32::from_be_bytes(body.get_array(0)?) {
                AUTHENTICATION_OK => {}
                AUTHENTICATION_SASL => {
                    let scram =
                        ScramSha256::new(password.as_bytes(), ChannelBinding::unsupported());
                    let mut buffer = bytes::BytesMut::new();
                    sasl_initial_response("SCRAM-SHA-256", scram.message(), &mut buffer)?;
                    backend.write_all(&buffer).await?;
                    session = Some(scram);
                }
                AUTHENTICATION_SASL_CONTINUE => {
                    let scram = session
                        .as_mut()
                        .ok_or_else(|| bad("unexpected sasl continue"))?;
                    scram.update(body.get_slice(4..)?)?;
                    let mut buffer = bytes::BytesMut::new();
                    sasl_response(scram.message(), &mut buffer)?;
                    backend.write_all(&buffer).await?;
                }
                AUTHENTICATION_SASL_FINAL => session
                    .as_mut()
                    .ok_or_else(|| bad("unexpected sasl final"))?
                    .finish(body.get_slice(4..)?)?,
                AUTHENTICATION_CLEARTEXT => {
                    let mut buffer = bytes::BytesMut::new();
                    password_message(password.as_bytes(), &mut buffer)?;
                    backend.write_all(&buffer).await?;
                }
                AUTHENTICATION_MD5 => {
                    return Err(bad("the backend asked for md5; use scram-sha-256"));
                }
                other => return Err(bad(&format!("unsupported backend auth {other}"))),
            },
            b'E' => {
                write_msg(client, b'E', &body).await?;
                return Err(bad("the backend rejected the startup"));
            }
            other => {
                write_msg(client, other, &body).await?;
                if other == b'Z' {
                    return Ok(());
                }
            }
        }
    }
}
