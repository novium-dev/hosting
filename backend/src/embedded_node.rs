use crate::config::BackendConfig;
use daemon::config::{BackupEntry, DaemonConfig, StorageEntry};
use daemon::{Daemon, WithUserKey};
use daemon_common::key::rcgen::{CertificateSigningRequestParams, KeyPair};
use daemon_common::key::{DaemonKey, DaemonRootKey};
use ed25519_dalek::SigningKey;
use rustls::pki_types::PrivateKeyDer;
use sqlx::{Connection as _, Pool, Postgres, query};
use std::io;
use std::io::ErrorKind;
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use uuid::Uuid;

pub async fn setup_embedded_node(
    db: &Pool<Postgres>,
    backend_config: &BackendConfig,
    root_key: Arc<DaemonRootKey>,
    root_privkey: &KeyPair,
    user_key: SigningKey,
) -> Result<Daemon<WithUserKey>, anyhow::Error> {
    let mut config_buffer = String::new();
    File::open("daemon.toml")
        .await
        .expect("Failed to open daemon config file")
        .read_to_string(&mut config_buffer)
        .await
        .expect("Unable to read daemon config file");
    let config: DaemonConfig = toml::from_str(&config_buffer).expect("Failed to parse config file");

    let key = match File::open("daemon.pem").await {
        Ok(mut key) => {
            let mut data = Vec::new();
            key.read_to_end(&mut data).await?;
            DaemonKey::parse(&root_key, &data)?
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let id = Uuid::new_v4();

            let keypair = KeyPair::generate()?;
            let request = DaemonKey::new_request(&keypair)?;
            let request = CertificateSigningRequestParams::from_der(&request)?;

            let signed = root_key.sign_daemon_key(root_privkey, request.public_key, id)?;

            let privkey =
                PrivateKeyDer::try_from(keypair.serialize_der()).map_err(io::Error::other)?;

            let key = DaemonKey::new(&root_key, signed, privkey)?;

            let mut file = File::create_new("daemon.pem").await?;
            file.write_all(key.dump().as_bytes()).await?;
            file.flush().await?;
            key
        }
        Err(err) => return Err(err.into()),
    };

    let daemon_url = backend_config.daemon.url.to_string();

    let config = db
        .acquire()
        .await?
        .transaction(move |tx| {
            Box::pin(async move {
                query!(
                    "INSERT INTO nodes
                    (id, display, url, default_host, default_bind)
                VALUES
                    ($1, 'Embedded', $2, 'localhost', '0.0.0.0')
                ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url",
                    key.id,
                    daemon_url,
                    daemon_url,
                )
                .execute(&mut **tx)
                .await?;

                query!("DELETE FROM node_server_storage WHERE node = $1", key.id)
                    .execute(&mut **tx)
                    .await?;

                query!("DELETE FROM node_backup_storage WHERE node = $1", key.id)
                    .execute(&mut **tx)
                    .await?;

                for (storage, entry) in &config.storage {
                    let (storage_type, group) = match entry {
                        StorageEntry::Directory { .. } => ("directory", None),
                        StorageEntry::Btrfs { group, .. } => ("btrfs", Some(group)),
                    };
                    query!(
                        r#"INSERT INTO node_server_storage (node, storage) VALUES ($1, $2)"#,
                        key.id,
                        storage
                    )
                    .execute(&mut **tx)
                    .await?;
                }
                for (storage, entry) in &config.backup {
                    let (storage_type, group) = match entry {
                        BackupEntry::Archive { .. } => ("archive", None),
                        BackupEntry::Btrfs { group, .. } => ("btrfs", Some(group)),
                    };
                    query!(
                        r#"INSERT INTO node_backup_storage (node, storage) VALUES ($1, $2)"#,
                        key.id,
                        storage
                    )
                    .execute(&mut **tx)
                    .await?;
                }
                Ok::<_, sqlx::Error>(config)
            })
        })
        .await?;

    let daemon = Daemon::init_embedded(
        config,
        root_key,
        Arc::new(key),
        backend_config.daemon.url.clone(),
        user_key,
    )
    .await?;

    daemon.serve_all().await?;

    Ok(daemon)
}
