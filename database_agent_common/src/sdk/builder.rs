use crate::sdk::{DatabaseAgentSDK, DatabaseAgentSDKServerNameResolver};
use core::time::Duration;
use either::Either;
use rustls::client::WebPkiServerVerifier;
use rustls::{ClientConfig, RootCertStore};
use std::sync::Arc;
use uuid::Uuid;
use zelus::reqwest::Client;
use zelus::url::Url;
use zelus_keys::{BackendKey, DaemonKeyVerifier, DaemonRootKey};

pub trait DatabaseAgentSDKBuilderState: DatabaseAgentSdkSealed {
    type Inner;
}

pub(crate) trait DatabaseAgentSdkSealed {}

pub enum RequiresIdentifier {}
pub enum RequiresRootKey {}
pub enum RequiresBackendKey {}
pub enum RequiresBaseURL {}

impl DatabaseAgentSdkSealed for RequiresIdentifier {}
impl DatabaseAgentSdkSealed for RequiresRootKey {}
impl DatabaseAgentSdkSealed for RequiresBackendKey {}
impl DatabaseAgentSdkSealed for RequiresBaseURL {}
impl DatabaseAgentSdkSealed for () {}

impl DatabaseAgentSDKBuilderState for RequiresIdentifier {
    type Inner = ();
}
impl DatabaseAgentSDKBuilderState for RequiresRootKey {
    type Inner = Uuid;
}
impl DatabaseAgentSDKBuilderState for RequiresBackendKey {
    type Inner = (Uuid, Either<Arc<DaemonRootKey>, Arc<RootCertStore>>);
}
impl DatabaseAgentSDKBuilderState for RequiresBaseURL {
    type Inner = (
        Uuid,
        Either<Arc<DaemonRootKey>, Arc<RootCertStore>>,
        Arc<BackendKey>,
    );
}
impl DatabaseAgentSDKBuilderState for () {
    type Inner = (
        Uuid,
        Either<Arc<DaemonRootKey>, Arc<RootCertStore>>,
        Arc<BackendKey>,
        Url,
    );
}

#[must_use]
pub struct DatabaseAgentSDKBuilder<T: DatabaseAgentSDKBuilderState>(T::Inner);

impl DatabaseAgentSDK {
    pub const fn builder() -> DatabaseAgentSDKBuilder<RequiresIdentifier> {
        DatabaseAgentSDKBuilder(())
    }
}

impl DatabaseAgentSDKBuilder<RequiresIdentifier> {
    pub const fn with_identifier(
        self,
        identifier: Uuid,
    ) -> DatabaseAgentSDKBuilder<RequiresRootKey> {
        DatabaseAgentSDKBuilder(identifier)
    }
}

impl DatabaseAgentSDKBuilder<RequiresRootKey> {
    pub const fn with_root_key(
        self,
        root: Arc<DaemonRootKey>,
    ) -> DatabaseAgentSDKBuilder<RequiresBackendKey> {
        DatabaseAgentSDKBuilder((self.0, Either::Left(root)))
    }

    pub const fn with_custom_cert_store(
        self,
        store: Arc<RootCertStore>,
    ) -> DatabaseAgentSDKBuilder<RequiresBackendKey> {
        DatabaseAgentSDKBuilder((self.0, Either::Right(store)))
    }
}

impl DatabaseAgentSDKBuilder<RequiresBackendKey> {
    pub fn with_backend_key(
        self,
        backend: Arc<BackendKey>,
    ) -> DatabaseAgentSDKBuilder<RequiresBaseURL> {
        DatabaseAgentSDKBuilder((self.0.0, self.0.1, backend))
    }
}

impl DatabaseAgentSDKBuilder<RequiresBaseURL> {
    pub fn with_url(self, mut url: Url) -> DatabaseAgentSDKBuilder<()> {
        url.set_query(None);
        url.set_fragment(None);
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        DatabaseAgentSDKBuilder((self.0.0, self.0.1, self.0.2, url))
    }
}

impl DatabaseAgentSDKBuilder<()> {
    pub fn build(self) -> DatabaseAgentSDK {
        let (identifier, root_key, backend_key, base_url) = self.0;

        let cert_store = match root_key {
            Either::Left(key) => Arc::clone(&key.cert_store),
            Either::Right(store) => store,
        };

        let mut tls = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(
                DaemonKeyVerifier::new(
                    crate::AGENT_KEY_PREFIX,
                    identifier,
                    WebPkiServerVerifier::builder(cert_store)
                        .build()
                        .expect("Unable to build webpki server verifier"),
                )
                .expect("the agent key prefix forms a valid dns name"),
            ))
            .with_client_auth_cert(
                backend_key.tls_cert.cert.clone(),
                backend_key.privkey.clone_key(),
            )
            .expect("Unable to build client config");
        tls.enable_sni = true;
        tls.alpn_protocols = vec!["h2".into()];

        DatabaseAgentSDK {
            client: Client::builder()
                .no_hickory_dns()
                .zstd(true)
                .https_only(true)
                .http2_prior_knowledge()
                .timeout(Duration::from_mins(2))
                .tls_backend_rustls()
                .tls_certs_only([])
                .tls_version_min(zelus::reqwest::tls::Version::TLS_1_3)
                .tls_sni(true)
                .tls_backend_preconfigured(tls)
                .with_server_name_resolver(Arc::new(DatabaseAgentSDKServerNameResolver(identifier)))
                .build()
                .expect("Unable to build reqwest client"),
            identifier,
            base_url,
        }
    }
}
