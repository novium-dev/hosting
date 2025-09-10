use daemon_common::key::rcgen::KeyPair;
use daemon_common::key::{BackendKey, DaemonRootKey};
use ed25519_dalek::SigningKey;
use rand::TryRngCore as _;
use rand::rngs::OsRng;
use tokio::fs;
use tokio::fs::File;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

pub async fn check_and_generate_keys() -> (DaemonRootKey, KeyPair, SigningKey, BackendKey) {
    let (root_key, root_privkey, user_key) = if fs::try_exists("./backend_root.pem")
        .await
        .expect("Unable to check backend_root.pem presence")
    {
        let mut file = File::open("./backend_root.pem")
            .await
            .expect("Unable to open backend_root.pem");
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .await
            .expect("Unable to read backend_root.pem");
        let (root_key, root_privkey, user_key) =
            DaemonRootKey::parse(buf).expect("Unable to parse root key");
        (
            root_key,
            root_privkey.expect("Root private key is missing"),
            user_key.expect("Private User key is missing"),
        )
    } else {
        let user_key = SigningKey::generate(&mut OsRng.unwrap_err());

        let root_privkey = KeyPair::generate().expect("Unable to generate root key");
        let root_key = DaemonRootKey::new(&root_privkey, Some(user_key.verifying_key()))
            .expect("Unable to generate x509 root key");

        let mut file = File::create_new("./backend_root.pem")
            .await
            .expect("Unable to create backend_root.pem");
        file.write_all(
            root_key
                .dump(Some(&root_privkey), Some(&user_key))
                .as_bytes(),
        )
        .await
        .expect("Unable to write backend_root.pem");
        file.flush()
            .await
            .expect("Unable to flush backend_root.pem");

        (root_key, root_privkey, user_key)
    };
    let backend_key = if fs::try_exists("./backend.pem")
        .await
        .expect("Unable to check backend.pem presence")
    {
        let mut file = File::open("./backend.pem")
            .await
            .expect("Unable to open backend.pem");
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .await
            .expect("Unable to read backend.pem");
        BackendKey::parse(&root_key, buf).expect("Unable to parse backend key")
    } else {
        let backend_keypair = KeyPair::generate().expect("Unable to generate backend key");
        let backend_key = root_key
            .new_backend_key(&root_privkey, &backend_keypair)
            .expect("Unable to create backend key");

        let mut file = File::create_new("./backend.pem")
            .await
            .expect("Unable to create backend.pem");
        file.write_all(backend_key.dump().as_bytes())
            .await
            .expect("Unable to write backend.pem");
        file.flush().await.expect("Unable to flush backend.pem");

        backend_key
    };

    (root_key, root_privkey, user_key, backend_key)
}
