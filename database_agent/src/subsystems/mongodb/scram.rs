#![expect(
    clippy::default_numeric_fallback,
    reason = "the wire protocol fixes both the byte order and the integer widths"
)]

use super::protocol::{binary, op_msg_doc, read_message, write_op_msg_request};
use crate::subsystems::scram;
use crate::utils::bad;
use bson::doc;
use std::io;
use std::path::{Path, PathBuf};
use tokio::net::UnixStream;

const SCRAM_ITERATIONS: u32 = 15_000;
const ADMIN_DATABASE: &str = "admin";

pub struct Session {
    bare: String,
    server_first: String,
    salt: [u8; scram::SALT_LENGTH],

    pub password: String,
    pub socket: PathBuf,
    pub user: String,
    pub database: String,
}

impl Session {
    pub fn start(
        password: &str,
        socket: &Path,
        bare: String,
        client_nonce: &str,
        user: String,
        database: String,
    ) -> (Self, String) {
        let salt = scram::random_bytes::<{ scram::SALT_LENGTH }>();
        let server_nonce = scram::encode(&scram::random_bytes::<{ scram::NONCE_LENGTH }>());
        let server_first = format!(
            "r={client_nonce}{server_nonce},s={},i={SCRAM_ITERATIONS}",
            scram::encode(&salt)
        );

        (
            Self {
                bare,
                server_first: server_first.clone(),
                salt,
                password: password.to_owned(),
                socket: socket.to_path_buf(),
                user,
                database,
            },
            server_first,
        )
    }

    pub fn verify(&self, client_final: &str) -> Option<String> {
        let proof = scram::field(client_final, "p=")?;
        let without_proof = client_final.rsplit_once(",p=").map(|(head, _)| head)?;

        let salted = scram::pbkdf2_sha256(self.password.as_bytes(), &self.salt, SCRAM_ITERATIONS);
        let auth_message = format!("{},{},{}", self.bare, self.server_first, without_proof);
        let (_, expected) = scram::client_proof(&salted, &auth_message);

        let given = scram::decode(&proof)?;
        if !constant_time_eq::constant_time_eq(&expected, &given) {
            return None;
        }

        Some(format!(
            "v={}",
            scram::server_signature(&salted, &auth_message)
        ))
    }
}

pub fn parse_client_first(client_first: &str) -> Option<(String, String, String)> {
    let bare = scram::bare_after_gs2(client_first)?.to_owned();
    let user = scram::unescape(&scram::field(&bare, "n=")?);
    let client_nonce = scram::field(&bare, "r=")?;

    Some((bare, client_nonce, user))
}

pub async fn backend_auth(socket: &Path, user: &str, password: &str) -> io::Result<UnixStream> {
    let mut backend = UnixStream::connect(socket).await?;

    write_op_msg_request(
        &mut backend,
        1,
        &doc! { "ismaster": 1, "$db": ADMIN_DATABASE },
    )
    .await?;
    read_message(&mut backend).await?;

    let client_nonce = scram::encode(&scram::random_bytes::<{ scram::NONCE_LENGTH }>());
    let bare = format!("n={},r={client_nonce}", scram::escape(user));

    write_op_msg_request(
        &mut backend,
        2,
        &doc! {
            "saslStart": 1,
            "mechanism": "SCRAM-SHA-256",
            "payload": binary(format!("n,,{bare}").as_bytes()),
            "$db": ADMIN_DATABASE,
        },
    )
    .await?;

    let (_, _, body) = read_message(&mut backend).await?;
    let reply = op_msg_doc(&body).ok_or_else(|| bad("bad backend reply"))?;
    let conversation_id = reply.get_i32("conversationId").unwrap_or(1);
    let server_first = String::from_utf8(
        reply
            .get_binary_generic("payload")
            .map_err(|_err| bad("no server-first"))?
            .clone(),
    )
    .map_err(|_err| bad("non-utf8 server-first"))?;

    let combined_nonce = scram::field(&server_first, "r=").ok_or_else(|| bad("no server nonce"))?;
    let salt = scram::field(&server_first, "s=")
        .as_deref()
        .and_then(scram::decode)
        .ok_or_else(|| bad("no salt"))?;
    let iterations: u32 = scram::field(&server_first, "i=")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| bad("no iteration count"))?;

    let salted = scram::pbkdf2_sha256(password.as_bytes(), &salt, iterations);
    let without_proof = format!("c=biws,r={combined_nonce}");
    let auth_message = format!("{bare},{server_first},{without_proof}");
    let (_, proof) = scram::client_proof(&salted, &auth_message);
    let client_final = format!("{without_proof},p={}", scram::encode(&proof));

    write_op_msg_request(
        &mut backend,
        3,
        &doc! {
            "saslContinue": 1,
            "conversationId": conversation_id,
            "payload": binary(client_final.as_bytes()),
            "$db": ADMIN_DATABASE,
        },
    )
    .await?;

    let (_, _, body) = read_message(&mut backend).await?;
    let reply = op_msg_doc(&body).ok_or_else(|| bad("bad backend reply"))?;
    if reply.get_f64("ok").ok() != Some(1.0) {
        return Err(bad("the backend rejected the auth"));
    }

    let server_final = String::from_utf8(
        reply
            .get_binary_generic("payload")
            .map_err(|_err| bad("no server-final"))?
            .clone(),
    )
    .map_err(|_err| bad("non-utf8 server-final"))?;

    if scram::field(&server_final, "v=") != Some(scram::server_signature(&salted, &auth_message)) {
        return Err(bad("the backend server signature does not match"));
    }

    if !reply.get_bool("done").unwrap_or(false) {
        write_op_msg_request(
            &mut backend,
            4,
            &doc! {
                "saslContinue": 1,
                "conversationId": conversation_id,
                "payload": binary(b""),
                "$db": ADMIN_DATABASE,
            },
        )
        .await?;

        let (_, _, body) = read_message(&mut backend).await?;
        let reply = op_msg_doc(&body).ok_or_else(|| bad("bad backend reply"))?;
        if reply.get_f64("ok").ok() != Some(1.0) || !reply.get_bool("done").unwrap_or(false) {
            return Err(bad("the backend auth did not complete"));
        }
    }

    Ok(backend)
}
