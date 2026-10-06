use ed25519_dalek::SigningKey;
use sqlx::{PgPool, query, query_as};
use std::path::Path;
use std::sync::Arc;
use tokio::fs;
use tracing::info;
use zelus_keys::rcgen::KeyPair;
use zelus_keys::{BackendKey, DaemonRootKey};

const KEY_LOCK: i64 = 0x6e6f_7669_756d_6b65;

struct StoredKeys {
    root_key: String,
    backend_key: String,
}

async fn read_legacy(data_dir: &Path) -> Option<StoredKeys> {
    let root_key = fs::read_to_string(data_dir.join("backend_root.pem"))
        .await
        .ok()?;
    let backend_key = fs::read_to_string(data_dir.join("backend.pem"))
        .await
        .ok()?;
    Some(StoredKeys {
        root_key,
        backend_key,
    })
}

fn generate() -> StoredKeys {
    let user_key = SigningKey::generate(&mut rand::rng());

    let root_privkey = KeyPair::generate().expect("Unable to generate root key");
    let root_key = DaemonRootKey::new(&root_privkey, Some(user_key.verifying_key()))
        .expect("Unable to generate x509 root key");

    let backend_keypair = KeyPair::generate().expect("Unable to generate backend key");
    let backend_key = root_key
        .new_backend_key(&root_privkey, &backend_keypair)
        .expect("Unable to create backend key");

    StoredKeys {
        root_key: root_key.dump(Some(&root_privkey), Some(&user_key)),
        backend_key: backend_key.dump(),
    }
}

async fn load_or_store(database: &PgPool, data_dir: &Path) -> Result<StoredKeys, sqlx::Error> {
    let mut tx = database.begin().await?;

    query!("SELECT pg_advisory_xact_lock($1)", KEY_LOCK)
        .execute(&mut *tx)
        .await?;

    if let Some(keys) = query_as!(StoredKeys, "SELECT root_key, backend_key FROM backend_keys")
        .fetch_optional(&mut *tx)
        .await?
    {
        tx.commit().await?;
        return Ok(keys);
    }

    let keys = read_legacy(data_dir).await.map_or_else(
        || {
            info!("Generating new backend keys");
            generate()
        },
        |keys| {
            info!(
                "Importing the backend keys from {} into the database",
                data_dir.display()
            );
            keys
        },
    );

    query!(
        "INSERT INTO backend_keys (root_key, backend_key) VALUES ($1, $2)",
        keys.root_key,
        keys.backend_key
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(keys)
}

pub async fn load_keys(
    database: &PgPool,
    data_dir: &Path,
) -> (Arc<DaemonRootKey>, KeyPair, SigningKey, BackendKey) {
    let keys = load_or_store(database, data_dir)
        .await
        .expect("Unable to load the backend keys");

    let (root_key, root_privkey, user_key) =
        DaemonRootKey::parse(keys.root_key.into_bytes()).expect("Unable to parse root key");
    let root_privkey = root_privkey.expect("Root private key is missing");
    let user_key = user_key.expect("Private User key is missing");

    let backend_key = BackendKey::parse(&root_key, keys.backend_key.into_bytes())
        .expect("Unable to parse backend key");

    (Arc::new(root_key), root_privkey, user_key, backend_key)
}
