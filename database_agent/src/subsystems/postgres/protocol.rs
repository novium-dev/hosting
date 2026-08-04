#![expect(
    clippy::big_endian_bytes,
    clippy::default_numeric_fallback,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

use crate::utils::bad;
use std::collections::HashMap;
use std::io;
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWrite, AsyncWriteExt as _};

pub const PROTOCOL_30: i32 = 0x0003_0000;
pub const SSL_REQUEST: i32 = 80_877_103;
pub const GSS_REQUEST: i32 = 80_877_104;

const MAX_MESSAGE_LENGTH: i32 = 16 * 1024 * 1024;
const MAX_STARTUP_LENGTH: i32 = 1 << 20;

pub type Params = HashMap<String, String>;

pub async fn read_startup_body<S: AsyncRead + Unpin>(stream: &mut S) -> io::Result<Vec<u8>> {
    let length = stream.read_i32().await?;
    if !(8..=MAX_STARTUP_LENGTH).contains(&length) {
        return Err(bad("implausible startup length"));
    }

    let mut body = vec![0; (length - 4) as usize];
    stream.read_exact(&mut body).await?;

    Ok(body)
}

pub fn startup_code(body: &[u8]) -> i32 {
    match *body {
        [first, second, third, fourth, ..] => i32::from_be_bytes([first, second, third, fourth]),
        _ => 0,
    }
}

pub fn parse_params(mut buffer: &[u8]) -> Params {
    let mut params = HashMap::new();
    while let Some(key) = next_cstr(&mut buffer) {
        if key.is_empty() {
            break;
        }
        params.insert(key, next_cstr(&mut buffer).unwrap_or_default());
    }

    params
}

fn next_cstr(buffer: &mut &[u8]) -> Option<String> {
    let end = buffer.iter().position(|&byte| byte == 0)?;
    let value = String::from_utf8_lossy(buffer.get(..end)?).into_owned();
    *buffer = buffer.get(end.saturating_add(1)..).unwrap_or_default();

    Some(value)
}

pub async fn read_msg<S: AsyncRead + Unpin>(stream: &mut S) -> io::Result<(u8, Vec<u8>)> {
    let tag = stream.read_u8().await?;
    let length = stream.read_i32().await?;
    if length < 4 {
        return Err(bad("short message"));
    }
    if length > MAX_MESSAGE_LENGTH {
        return Err(bad("message too large"));
    }

    let mut body = vec![0; (length - 4) as usize];
    stream.read_exact(&mut body).await?;

    Ok((tag, body))
}

pub async fn write_msg<S: AsyncWrite + Unpin>(
    stream: &mut S,
    tag: u8,
    body: &[u8],
) -> io::Result<()> {
    stream.write_u8(tag).await?;
    stream.write_i32((body.len() + 4) as i32).await?;
    stream.write_all(body).await
}

pub async fn send_error<S: AsyncWrite + Unpin>(
    stream: &mut S,
    code: &str,
    message: &str,
) -> io::Result<()> {
    let mut body = vec![b'S'];
    body.extend_from_slice(b"FATAL\0");
    body.push(b'C');
    body.extend_from_slice(code.as_bytes());
    body.push(0);
    body.push(b'M');
    body.extend_from_slice(message.as_bytes());
    body.push(0);
    body.push(0);

    write_msg(stream, b'E', &body).await
}

pub async fn send_startup<S: AsyncWrite + Unpin>(
    backend: &mut S,
    params: &Params,
) -> io::Result<()> {
    let mut buffer = bytes::BytesMut::new();
    postgres_protocol::message::frontend::startup_message(
        params
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str())),
        &mut buffer,
    )
    .map_err(|err| bad(&err.to_string()))?;

    backend.write_all(&buffer).await
}
