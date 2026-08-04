#![expect(
    clippy::little_endian_bytes,
    clippy::default_numeric_fallback,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

use crate::utils::{SafeArrayExt as _, SafeSliceExt as _, bad};
use std::io;
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWrite, AsyncWriteExt as _};

pub const CLIENT_LONG_PASSWORD: u32 = 0x0000_0001;
pub const CLIENT_LONG_FLAG: u32 = 0x0000_0004;
pub const CLIENT_CONNECT_WITH_DB: u32 = 0x0000_0008;
pub const CLIENT_PROTOCOL_41: u32 = 0x0000_0200;
pub const CLIENT_TRANSACTIONS: u32 = 0x0000_2000;
pub const CLIENT_SECURE_CONNECTION: u32 = 0x0000_8000;
pub const CLIENT_MULTI_STATEMENTS: u32 = 0x0001_0000;
pub const CLIENT_MULTI_RESULTS: u32 = 0x0002_0000;
pub const CLIENT_PLUGIN_AUTH: u32 = 0x0008_0000;
pub const CLIENT_PLUGIN_AUTH_LENENC: u32 = 0x0020_0000;

pub const NATIVE: &str = "mysql_native_password";

const CAPS: u32 = CLIENT_LONG_PASSWORD
    | CLIENT_LONG_FLAG
    | CLIENT_PROTOCOL_41
    | CLIENT_SECURE_CONNECTION
    | CLIENT_PLUGIN_AUTH
    | CLIENT_CONNECT_WITH_DB
    | CLIENT_TRANSACTIONS
    | CLIENT_MULTI_STATEMENTS
    | CLIENT_MULTI_RESULTS;

const BACKEND_REQUIRED_CAPS: u32 =
    CLIENT_PROTOCOL_41 | CLIENT_SECURE_CONNECTION | CLIENT_CONNECT_WITH_DB | CLIENT_PLUGIN_AUTH;

const BACKEND_FORWARDABLE_CAPS: u32 = CLIENT_LONG_PASSWORD
    | CLIENT_LONG_FLAG
    | CLIENT_TRANSACTIONS
    | CLIENT_MULTI_STATEMENTS
    | CLIENT_MULTI_RESULTS;

const CHARSET_UTF8MB4: u8 = 45;
const STATUS_AUTOCOMMIT: u16 = 0x0002;
const MAX_PACKET: u32 = 16 * 1024 * 1024;

pub fn server_handshake(scramble: &[u8; 20]) -> io::Result<Vec<u8>> {
    let mut packet = vec![10];
    packet.extend_from_slice(b"8.0.30");
    packet.push(0);
    packet.extend_from_slice(&1u32.to_le_bytes());
    packet.extend_from_slice(scramble.get_slice(..8)?);
    packet.push(0);
    packet.extend_from_slice(&(CAPS as u16).to_le_bytes());
    packet.push(CHARSET_UTF8MB4);
    packet.extend_from_slice(&STATUS_AUTOCOMMIT.to_le_bytes());
    packet.extend_from_slice(&((CAPS >> 16) as u16).to_le_bytes());
    packet.push(21);
    packet.extend_from_slice(&[0; 10]);
    packet.extend_from_slice(scramble.get_slice(8..20)?);
    packet.push(0);
    packet.extend_from_slice(NATIVE.as_bytes());
    packet.push(0);

    Ok(packet)
}

pub fn handshake_response(user: &str, token: &[u8], database: &str, client_caps: u32) -> Vec<u8> {
    let caps = BACKEND_REQUIRED_CAPS | (client_caps & BACKEND_FORWARDABLE_CAPS);

    let mut packet = caps.to_le_bytes().to_vec();
    packet.extend_from_slice(&MAX_PACKET.to_le_bytes());
    packet.push(CHARSET_UTF8MB4);
    packet.extend_from_slice(&[0; 23]);
    packet.extend_from_slice(user.as_bytes());
    packet.push(0);
    packet.push(token.len() as u8);
    packet.extend_from_slice(token);
    packet.extend_from_slice(database.as_bytes());
    packet.push(0);
    packet.extend_from_slice(NATIVE.as_bytes());
    packet.push(0);
    packet
}

pub fn auth_switch_request(scramble: &[u8; 20]) -> Vec<u8> {
    let mut packet = vec![0xfe];
    packet.extend_from_slice(NATIVE.as_bytes());
    packet.push(0);
    packet.extend_from_slice(scramble);
    packet.push(0);
    packet
}

pub fn ok_packet() -> Vec<u8> {
    let mut packet = vec![0x00, 0x00, 0x00];
    packet.extend_from_slice(&STATUS_AUTOCOMMIT.to_le_bytes());
    packet.extend_from_slice(&0u16.to_le_bytes());
    packet
}

pub fn err_packet(code: u16, sqlstate: &str, message: &str) -> Vec<u8> {
    let mut packet = vec![0xff];
    packet.extend_from_slice(&code.to_le_bytes());
    packet.push(b'#');
    packet.extend_from_slice(sqlstate.as_bytes());
    packet.extend_from_slice(message.as_bytes());
    packet
}

pub struct HandshakeResponse {
    pub caps: u32,
    pub user: String,
    pub auth_response: Vec<u8>,
    pub database: String,
    pub plugin: String,
}

pub fn parse_handshake_response(packet: &[u8]) -> io::Result<HandshakeResponse> {
    if packet.len() < 32 {
        return Err(bad("short handshake response"));
    }

    let caps = u32::from_le_bytes(packet.get_array(0)?);
    let mut cursor = 32;

    let user = read_cstr(packet, &mut cursor)?;
    let auth_response = if caps & CLIENT_PLUGIN_AUTH_LENENC != 0 {
        let length = read_lenenc(packet, &mut cursor)? as usize;
        read_n(packet, &mut cursor, length)?
    } else if caps & CLIENT_SECURE_CONNECTION != 0 {
        let length = *packet
            .get(cursor)
            .ok_or_else(|| bad("unexpected end of buffer"))? as usize;
        cursor = cursor.saturating_add(1);
        read_n(packet, &mut cursor, length)?
    } else {
        read_cstr_bytes(packet, &mut cursor)?
    };

    let database = if caps & CLIENT_CONNECT_WITH_DB != 0 {
        read_cstr(packet, &mut cursor)?
    } else {
        String::new()
    };
    let plugin = if caps & CLIENT_PLUGIN_AUTH != 0 {
        read_cstr(packet, &mut cursor).unwrap_or_default()
    } else {
        String::new()
    };

    Ok(HandshakeResponse {
        caps,
        user,
        auth_response,
        database,
        plugin,
    })
}

pub fn parse_server_handshake(packet: &[u8]) -> io::Result<[u8; 20]> {
    let mut cursor = 1;
    read_cstr(packet, &mut cursor)?;
    cursor = cursor.saturating_add(4);

    let mut scramble = [0; 20];
    let (head, tail) = scramble.split_at_mut(8);
    head.copy_from_slice(packet.get_slice(cursor..cursor.saturating_add(8))?);
    cursor = cursor.saturating_add(9);

    let caps_low = u16::from_le_bytes(packet.get_array(cursor)?);
    cursor = cursor.saturating_add(5);
    let caps_high = u16::from_le_bytes(packet.get_array(cursor)?);
    cursor = cursor.saturating_add(2);

    let caps = (u32::from(caps_high) << 16) | u32::from(caps_low);
    if caps & CLIENT_SECURE_CONNECTION == 0 {
        return Err(bad("the backend does not support secure connections"));
    }

    let data_length = *packet
        .get(cursor)
        .ok_or_else(|| bad("unexpected end of buffer"))? as usize;
    cursor = cursor.saturating_add(11);
    tail.copy_from_slice(packet.get_slice(cursor..cursor.saturating_add(12))?);

    if data_length < 8 {
        return Err(bad("short backend scramble"));
    }

    Ok(scramble)
}

pub fn read_cstr(packet: &[u8], cursor: &mut usize) -> io::Result<String> {
    let start = *cursor;
    while packet.get(*cursor).is_some_and(|&byte| byte != 0) {
        *cursor = cursor.saturating_add(1);
    }
    if *cursor >= packet.len() {
        return Err(bad("unterminated string"));
    }

    let value = String::from_utf8_lossy(packet.get_slice(start..*cursor)?).into_owned();
    *cursor = cursor.saturating_add(1);

    Ok(value)
}

fn read_cstr_bytes(packet: &[u8], cursor: &mut usize) -> io::Result<Vec<u8>> {
    let start = *cursor;
    while packet.get(*cursor).is_some_and(|&byte| byte != 0) {
        *cursor = cursor.saturating_add(1);
    }

    let value = packet.get_slice(start..*cursor)?.to_vec();
    *cursor = cursor.saturating_add(1);

    Ok(value)
}

fn read_n(packet: &[u8], cursor: &mut usize, length: usize) -> io::Result<Vec<u8>> {
    let value = packet
        .get_slice(*cursor..cursor.saturating_add(length))?
        .to_vec();
    *cursor = cursor.saturating_add(length);

    Ok(value)
}

fn read_lenenc(packet: &[u8], cursor: &mut usize) -> io::Result<u64> {
    let first = *packet
        .get(*cursor)
        .ok_or_else(|| bad("unexpected end of buffer"))?;
    *cursor = cursor.saturating_add(1);

    Ok(match first {
        value if value < 0xfb => u64::from(value),
        0xfc => {
            let value = u64::from(u16::from_le_bytes(packet.get_array(*cursor)?));
            *cursor = cursor.saturating_add(2);
            value
        }
        0xfd => {
            let [first_byte, second_byte, third_byte] = packet.get_array(*cursor)?;
            *cursor = cursor.saturating_add(3);
            u64::from(u32::from_le_bytes([first_byte, second_byte, third_byte, 0]))
        }
        _ => {
            let value = u64::from_le_bytes(packet.get_array(*cursor)?);
            *cursor = cursor.saturating_add(8);
            value
        }
    })
}

pub async fn read_packet<S: AsyncRead + Unpin>(stream: &mut S) -> io::Result<(u8, Vec<u8>)> {
    let mut header = [0; 4];
    stream.read_exact(&mut header).await?;

    let length = u32::from_le_bytes([
        *header.first().ok_or_else(|| bad("short header"))?,
        *header.get(1).ok_or_else(|| bad("short header"))?,
        *header.get(2).ok_or_else(|| bad("short header"))?,
        0,
    ]) as usize;
    let sequence = *header.get(3).ok_or_else(|| bad("short header"))?;

    let mut payload = vec![0; length];
    stream.read_exact(&mut payload).await?;

    Ok((sequence, payload))
}

pub async fn write_packet<S: AsyncWrite + Unpin>(
    stream: &mut S,
    sequence: u8,
    payload: &[u8],
) -> io::Result<()> {
    let length = payload.len();
    stream
        .write_all(&[
            length as u8,
            (length >> 8) as u8,
            (length >> 16) as u8,
            sequence,
        ])
        .await?;
    stream.write_all(payload).await
}
