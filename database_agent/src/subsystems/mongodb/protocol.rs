#![expect(
    clippy::little_endian_bytes,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

use crate::utils::bad;
use bson::spec::BinarySubtype;
use bson::{Binary, Bson, DateTime, Document, doc};
use std::io;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWrite, AsyncWriteExt as _};

pub const MAX_MESSAGE: usize = 48 * 1000 * 1000;
pub const OP_REPLY: i32 = 1;
pub const OP_QUERY: i32 = 2004;
pub const OP_MSG: i32 = 2013;

const HEADER_LENGTH: usize = 16;
const AUTHENTICATION_FAILED: i32 = 18;

pub fn binary(bytes: impl Into<Vec<u8>>) -> Bson {
    Bson::Binary(Binary {
        subtype: BinarySubtype::Generic,
        bytes: bytes.into(),
    })
}

pub fn hello_doc() -> Document {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64);

    doc! {
        "ismaster": true,
        "isWritablePrimary": true,
        "maxBsonObjectSize": 16 * 1024 * 1024,
        "maxMessageSizeBytes": MAX_MESSAGE as i32,
        "maxWriteBatchSize": 100_000,
        "localTime": DateTime::from_millis(now),
        "logicalSessionTimeoutMinutes": 30,
        "connectionId": 1,
        "minWireVersion": 0,
        "maxWireVersion": 9,
        "readOnly": false,
        "saslSupportedMechs": ["SCRAM-SHA-256"],
        "ok": 1.0,
    }
}

pub fn sasl_error(message: &str) -> Document {
    doc! {
        "ok": 0.0,
        "errmsg": message,
        "code": AUTHENTICATION_FAILED,
        "codeName": "AuthenticationFailed",
    }
}

pub async fn read_message<S: AsyncRead + Unpin>(
    stream: &mut S,
) -> io::Result<(i32, i32, Vec<u8>)> {
    let length = stream.read_i32_le().await? as usize;
    let request_id = stream.read_i32_le().await?;
    let _response_to = stream.read_i32_le().await?;
    let opcode = stream.read_i32_le().await?;

    if !(HEADER_LENGTH..=MAX_MESSAGE).contains(&length) {
        return Err(bad("implausible message length"));
    }

    let mut body = vec![0; length - HEADER_LENGTH];
    stream.read_exact(&mut body).await?;

    Ok((request_id, opcode, body))
}

pub fn op_msg_doc(body: &[u8]) -> Option<Document> {
    if *body.get(4)? != 0 {
        return None;
    }

    Document::from_reader(body.get(5..)?).ok()
}

fn encode_op_msg(document: &Document) -> io::Result<Vec<u8>> {
    let mut body = Vec::new();
    body.extend_from_slice(&0u32.to_le_bytes());
    body.push(0x00);
    document
        .to_writer(&mut body)
        .map_err(|_err| bad("failed to encode bson"))?;

    Ok(body)
}

pub async fn write_op_msg<S: AsyncWrite + Unpin>(
    stream: &mut S,
    response_to: i32,
    document: &Document,
) -> io::Result<()> {
    let body = encode_op_msg(document)?;
    write_header(stream, 0, response_to, OP_MSG, &body).await
}

pub async fn write_op_msg_request<S: AsyncWrite + Unpin>(
    stream: &mut S,
    request_id: i32,
    document: &Document,
) -> io::Result<()> {
    let body = encode_op_msg(document)?;
    write_header(stream, request_id, 0, OP_MSG, &body).await
}

pub async fn write_op_reply<S: AsyncWrite + Unpin>(
    stream: &mut S,
    response_to: i32,
    document: &Document,
) -> io::Result<()> {
    let mut body = Vec::new();
    body.extend_from_slice(&0i32.to_le_bytes());
    body.extend_from_slice(&0i64.to_le_bytes());
    body.extend_from_slice(&0i32.to_le_bytes());
    body.extend_from_slice(&1i32.to_le_bytes());
    document
        .to_writer(&mut body)
        .map_err(|_err| bad("failed to encode bson"))?;

    write_header(stream, 0, response_to, OP_REPLY, &body).await
}

async fn write_header<S: AsyncWrite + Unpin>(
    stream: &mut S,
    request_id: i32,
    response_to: i32,
    opcode: i32,
    body: &[u8],
) -> io::Result<()> {
    let length = (HEADER_LENGTH + body.len()) as i32;

    let mut header = Vec::with_capacity(HEADER_LENGTH);
    header.extend_from_slice(&length.to_le_bytes());
    header.extend_from_slice(&request_id.to_le_bytes());
    header.extend_from_slice(&response_to.to_le_bytes());
    header.extend_from_slice(&opcode.to_le_bytes());

    stream.write_all(&header).await?;
    stream.write_all(body).await
}
