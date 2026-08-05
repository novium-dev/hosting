#![expect(
    clippy::big_endian_bytes,
    reason = "the wire protocol fixes the byte order, the integer widths and the encodings"
)]

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use hmac::{Hmac, KeyInit as _, Mac as _};
use rand::Rng as _;
use sha2::{Digest as _, Sha256};

pub const DIGEST_LENGTH: usize = 32;
pub const NONCE_LENGTH: usize = 18;
pub const SALT_LENGTH: usize = 16;

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}

pub fn encode(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

pub fn decode(value: &str) -> Option<Vec<u8>> {
    BASE64.decode(value).ok()
}

pub fn hmac(key: &[u8], message: &[u8]) -> [u8; DIGEST_LENGTH] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(message);
    mac.finalize().into_bytes().into()
}

pub fn sha256(data: &[u8]) -> [u8; DIGEST_LENGTH] {
    Sha256::digest(data).into()
}

pub fn pbkdf2_sha256(password: &[u8], salt: &[u8], iterations: u32) -> [u8; DIGEST_LENGTH] {
    let mut mac = Hmac::<Sha256>::new_from_slice(password).expect("hmac accepts any key length");
    mac.update(salt);
    mac.update(&1u32.to_be_bytes());

    let mut block: [u8; DIGEST_LENGTH] = mac.finalize().into_bytes().into();
    let mut result = block;
    for _ in 1..iterations {
        block = hmac(password, &block);
        for (accumulated, value) in result.iter_mut().zip(block) {
            *accumulated ^= value;
        }
    }

    result
}

pub fn client_proof(
    salted: &[u8; DIGEST_LENGTH],
    auth_message: &str,
) -> ([u8; DIGEST_LENGTH], Vec<u8>) {
    let client_key = hmac(salted, b"Client Key");
    let stored_key = sha256(&client_key);
    let signature = hmac(&stored_key, auth_message.as_bytes());

    (
        client_key,
        client_key
            .iter()
            .zip(signature)
            .map(|(key, sign)| key ^ sign)
            .collect(),
    )
}

pub fn server_signature(salted: &[u8; DIGEST_LENGTH], auth_message: &str) -> String {
    let server_key = hmac(salted, b"Server Key");
    encode(&hmac(&server_key, auth_message.as_bytes()))
}

pub fn field(message: &str, prefix: &str) -> Option<String> {
    message
        .split(',')
        .find(|part| part.starts_with(prefix))
        .and_then(|part| part.get(prefix.len()..))
        .map(ToOwned::to_owned)
}

pub fn bare_after_gs2(client_first: &str) -> Option<&str> {
    let mut commas = 0u8;
    for (index, character) in client_first.char_indices() {
        if character == ',' {
            commas += 1u8;
            if commas == 2u8 {
                return client_first.get(index.saturating_add(1)..);
            }
        }
    }

    None
}

pub fn escape(value: &str) -> String {
    value.replace('=', "=3D").replace(',', "=2C")
}

pub fn unescape(value: &str) -> String {
    value.replace("=2C", ",").replace("=3D", "=")
}
