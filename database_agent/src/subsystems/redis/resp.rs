#![expect(
    clippy::cast_sign_loss,
    reason = "the wire protocol fixes the byte order, the integer widths and the encodings"
)]

use crate::utils::bad;
use std::io;
use tokio::io::{AsyncRead, AsyncReadExt as _};

const MAX_ARGS: i64 = 1024;
const MAX_COMMAND_LENGTH: usize = 1024 * 1024;
const MAX_LINE_LENGTH: usize = 64 * 1024;

pub type Command = Vec<Vec<u8>>;

pub async fn read_command<S: AsyncRead + Unpin>(stream: &mut S) -> io::Result<Option<Command>> {
    let mut raw_length = 0;

    let first = match stream.read_u8().await {
        Ok(byte) => byte,
        Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(err) => return Err(err),
    };

    if first != b'*' {
        let mut line = read_line(stream, &mut raw_length).await?;
        line.insert(0, first);

        return Ok(Some(
            line.split(u8::is_ascii_whitespace)
                .filter(|argument| !argument.is_empty())
                .map(<[u8]>::to_vec)
                .collect(),
        ));
    }

    let count = parse_int(&read_line(stream, &mut raw_length).await?)?;
    if count < 0 {
        return Ok(Some(Vec::new()));
    }
    if count > MAX_ARGS {
        return Err(bad("multibulk count too large"));
    }

    let mut arguments = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let marker = stream.read_u8().await?;
        if marker != b'$' {
            return Err(bad("expected a bulk string"));
        }

        let length = parse_int(&read_line(stream, &mut raw_length).await?)?;
        if length < 0 {
            arguments.push(Vec::new());
            continue;
        }
        if length as usize > MAX_COMMAND_LENGTH.saturating_sub(raw_length) {
            return Err(bad("command too large"));
        }

        let mut buffer = vec![0; length as usize];
        stream.read_exact(&mut buffer).await?;
        raw_length = raw_length.saturating_add(buffer.len());

        stream.read_u8().await?;
        stream.read_u8().await?;
        arguments.push(buffer);
    }

    Ok(Some(arguments))
}

async fn read_line<S: AsyncRead + Unpin>(
    stream: &mut S,
    raw_length: &mut usize,
) -> io::Result<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        if line.len() > MAX_LINE_LENGTH {
            return Err(bad("protocol line too long"));
        }

        let byte = stream.read_u8().await?;
        *raw_length = raw_length.saturating_add(1);

        if byte == b'\r' {
            let next = stream.read_u8().await?;
            *raw_length = raw_length.saturating_add(1);
            if next == b'\n' {
                break;
            }
            line.push(b'\r');
            line.push(next);
        } else {
            line.push(byte);
        }
    }

    Ok(line)
}

fn parse_int(bytes: &[u8]) -> io::Result<i64> {
    core::str::from_utf8(bytes)
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .ok_or_else(|| bad("bad integer"))
}

pub fn encode_command(arguments: &[Vec<u8>]) -> Vec<u8> {
    let mut encoded = format!("*{}\r\n", arguments.len()).into_bytes();
    for argument in arguments {
        encoded.extend_from_slice(format!("${}\r\n", argument.len()).as_bytes());
        encoded.extend_from_slice(argument);
        encoded.extend_from_slice(b"\r\n");
    }

    encoded
}

fn auth_position(arguments: &[Vec<u8>]) -> Option<usize> {
    arguments
        .iter()
        .position(|argument| argument.eq_ignore_ascii_case(b"AUTH"))
}

pub fn hello_user(arguments: &[Vec<u8>]) -> Option<String> {
    let position = auth_position(arguments)?;
    arguments
        .get(position.saturating_add(1))
        .map(|user| String::from_utf8_lossy(user).into_owned())
}

pub fn hello_password(arguments: &[Vec<u8>]) -> Option<Vec<u8>> {
    let position = auth_position(arguments)?;
    arguments.get(position.saturating_add(2)).cloned()
}

pub fn strip_hello_auth(arguments: &[Vec<u8>]) -> Vec<Vec<u8>> {
    let mut stripped = Vec::new();
    let mut index = 0;

    while let Some(argument) = arguments.get(index) {
        if argument.eq_ignore_ascii_case(b"AUTH") {
            index = index.saturating_add(3);
        } else {
            stripped.push(argument.clone());
            index = index.saturating_add(1);
        }
    }

    stripped
}
