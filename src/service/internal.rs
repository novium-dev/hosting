use super::*;
use crate::service::internal::internal_service_error::{AuthPasswordError, AuthPublickeyError};
use crate::{
    Backend,
    service::internal::{
        error_internal_daemon_key_invalid::FromInternalDaemonKeyInvalid,
        error_internal_daemon_unreachable::FromInternalDaemonUnreachable,
        internal_service_error::{DaemonRegisterError, DaemonRootKeyError, DaemonUpdateError},
    },
};
use axum_extra::headers::authorization::Basic;
use axum_extra::{
    TypedHeader,
    headers::{Authorization, authorization::Bearer},
};
use core::time::Duration;
use daemon_common::ssh::DaemonBackendAuthResponse;
use daemon_common::{
    key::rcgen::{CertificateSigningRequestParams, DnType, DnValue},
    node::{BackupStorage, NodeRegistrationRequest, NodeUpdateRequest, ServerStorage},
    sdk::DaemonSDK,
    service::setup::{SetupService as _, setup_service_error::ConnectionTestError},
};
use rustls::{
    RootCertStore,
    pki_types::{CertificateDer, CertificateSigningRequestDer},
};
use sqlx::{Connection as _, MySql, Transaction, query};
use std::{collections::HashMap, sync::Arc};
use tracing::{debug, error, info};
use url::Url;
use uuid::Uuid;
use zelus::{define_header_variable, service};

define_header_variable!(generated_arg_1 "The authorization code for the registration");
define_header_variable!(generated_arg_2 "The authorizations credentials of the user");

define_error!(internal_daemon {
    key_invalid("Invalid key for certificate request" BAD_REQUEST),
    unreachable("Connection test failed" BAD_GATEWAY),
    sign_failed("Unable to sign daemon key" INTERNAL_SERVER_ERROR)
});

define_query_variable!(
    node "The node ID"
);

const REGISTRATION_TIMEOUT: Duration = Duration::from_mins(10);

#[service(path = "/internal", tag = "internal", no_sdk)]
pub(crate) impl InternalService for Backend {
    /// Returns the public daemon root key as pem.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/daemon/root_key", no_auth)]
    #[error(auth::invalid)]
    async fn daemon_root_key(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
    ) -> Result<String, _> {
        if let Some((elapsed_time, _)) = self
            .node_registrations
            .read()
            .await
            .get(&auth.token().to_owned())
            && elapsed_time.elapsed() < REGISTRATION_TIMEOUT
        {
            Ok(self.root_key.dump(None, None))
        } else {
            Err(DaemonRootKeyError::AuthInvalid)
        }
    }

    /// Registers a new daemon.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/daemon/register", method = POST, raw, no_auth)]
    #[error(internal_daemon::{key_invalid, unreachable, sign_failed}, db::failure <- [sql:*], auth::invalid)]
    async fn daemon_register(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
        NodeRegistrationRequest {
            cert,
            csr,
            base_url,
            storages,
            backups,
            default_bind,
            default_host,
            // TODO: SSH
            ..
        }: NodeRegistrationRequest,
    ) -> Result<Vec<u8>, _> {
        if let Some((elapsed_time, None)) = self
            .node_registrations
            .write()
            .await
            .remove(&auth.token().to_owned())
            && elapsed_time.elapsed() < REGISTRATION_TIMEOUT
        {
            let cert = CertificateDer::from(cert);

            daemon_connection_test::<DaemonRegisterError>(
                Uuid::nil(),
                &base_url,
                self,
                Some(&cert),
            )
            .await?;

            let csr = CertificateSigningRequestDer::from(csr);
            let csr = CertificateSigningRequestParams::from_der(&csr)
                .map_err(|_err| DaemonRegisterError::InternalDaemonKeyInvalid)?;
            let Some(common_name) = csr.params.distinguished_name.get(&DnType::CommonName) else {
                return Err(DaemonRegisterError::InternalDaemonKeyInvalid);
            };
            if !common_name.eq(&DnValue::from("node")) {
                return Err(DaemonRegisterError::InternalDaemonKeyInvalid);
            }

            let uuid = Uuid::new_v4();
            let signed = self
                .root_key
                .sign_daemon_key(&self.root_privkey, csr.public_key, uuid)
                .inspect_err(|err| error!("Unable to sign daemon cert: {err:?}"))
                .map_err(|_err| DaemonRegisterError::InternalDaemonSignFailed)?;

            let backend = self.clone();
            self.database.acquire().await?
                .transaction(move |tx| Box::pin(async move {
                    query!("INSERT INTO `nodes` (`id`,`display`,`url`,`default_bind`,`default_host`) VALUES (?, 'New node', ?, ?, ?)", &uuid, base_url.as_str(), &default_bind, &default_host)
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| error!("Failed to insert node: {err:?}"))?;

                    insert_storages(tx, &uuid, storages, backups).await?;

                    backend.sync_nodes(tx).await?;

                    Ok::<_, DaemonRegisterError>(())
                }))
                .await?;

            Ok(signed.to_vec())
        } else {
            Err(DaemonRegisterError::AuthInvalid)
        }
    }

    /// Updates an existing daemon.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/daemon/update", method = POST, no_auth)]
    #[error(internal_daemon::{key_invalid, unreachable}, db::failure <- [sql:*], auth::invalid)]
    async fn daemon_update(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
        NodeUpdateRequest {
            base_url,
            storages,
            backups,
            // TODO: SSH
            ..
        }: NodeUpdateRequest,
    ) -> Result<(), _> {
        if let Some((elapsed_time, Some(node_id))) = self
            .node_registrations
            .write()
            .await
            .remove(&auth.token().to_owned())
            && elapsed_time.elapsed() < REGISTRATION_TIMEOUT
        {
            daemon_connection_test::<DaemonUpdateError>(node_id, &base_url, self, None).await?;

            let backend = self.clone();

            self.database
                .acquire()
                .await?
                .transaction(move |tx| {
                    Box::pin(async move {
                        query!(
                            "UPDATE `nodes` SET `url` = ? WHERE `id` = ?",
                            base_url.as_str(),
                            node_id
                        )
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| error!("Unable to update base_url of node: {err:?}"))?;

                        query!(
                            "DELETE FROM `node_server_storage` WHERE `node` = ?",
                            node_id
                        )
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| {
                            error!("Unable to delete prior server storages: {err:?}");
                        })?;

                        query!(
                            "DELETE FROM `node_backup_storage` WHERE `node` = ?",
                            node_id
                        )
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| {
                            error!("Unable to delete prior backup storages: {err:?}");
                        })?;

                        insert_storages(tx, &node_id, storages, backups).await?;

                        backend.sync_nodes(tx).await?;

                        Ok(())
                    })
                })
                .await
        } else {
            Err(DaemonUpdateError::AuthInvalid)
        }
    }

    #[route("/auth/password", no_auth, query = [ node ])]
    #[error(auth::invalid)]
    async fn auth_password(
        &self,
        node: String,
        TypedHeader(Authorization(_auth)): TypedHeader<Authorization<Basic>>,
    ) -> Result<DaemonBackendAuthResponse, _> {
        info!(
            "Received password auth request for node {node}, but password auth is not yet implemented"
        );
        Err(AuthPasswordError::AuthInvalid)
    }

    #[route("/auth/publickey", no_auth, query = [ node ])]
    #[error(auth::invalid)]
    async fn auth_publickey(
        &self,
        node: String,
        TypedHeader(Authorization(_auth)): TypedHeader<Authorization<Basic>>,
    ) -> Result<DaemonBackendAuthResponse, _> {
        info!(
            "Received SSH public key auth request for node {node}, but SSH is not yet implemented"
        );
        Err(AuthPublickeyError::AuthInvalid)
    }
}

async fn insert_storages(
    tx: &mut Transaction<'_, MySql>,
    id: &Uuid,
    storages: HashMap<String, ServerStorage>,
    backups: HashMap<String, BackupStorage>,
) -> Result<(), sqlx::Error> {
    for (storage_id, storage) in storages {
        let storage_type = match storage {
            ServerStorage::Btrfs(_) => "btrfs",
            ServerStorage::Directory => "directory",
        };
        let group = match storage {
            ServerStorage::Btrfs(group) => Some(group),
            ServerStorage::Directory => None,
        };
        query!("INSERT INTO `node_server_storage` (`node`,`storage`,`storage_type`,`group`) VALUES (?, ?, ?, ?)", id, storage_id, storage_type, group)
            .execute(&mut **tx)
            .await
            .inspect_err(|err| {
                error!(
                    "Failed to insert node (server_storage, insertion): {err:?}"
                );
            })?;
    }
    for (storage_id, storage) in backups {
        let storage_type = match storage {
            BackupStorage::Btrfs(_) => "btrfs",
            BackupStorage::Archive => "archive",
        };
        let group = match storage {
            BackupStorage::Btrfs(group) => Some(group),
            BackupStorage::Archive => None,
        };
        query!("INSERT INTO `node_backup_storage` (`node`,`storage`,`storage_type`,`group`) VALUES (?, ?, ?, ?)", id, storage_id, storage_type, group)
                .execute(&mut **tx)
                .await
                .inspect_err(|err| error!("Failed to insert node (server_storage, insertion): {err:?}"))?;
    }
    Ok(())
}

async fn daemon_connection_test<E: FromInternalDaemonUnreachable + FromInternalDaemonKeyInvalid>(
    identifier: Uuid,
    base_url: &Url,
    backend: &Backend,
    trust: Option<&CertificateDer<'static>>,
) -> Result<(), E> {
    let sdk_builder = DaemonSDK::builder().with_identifier(identifier);
    let sdk_builder = match trust {
        None => sdk_builder.with_root_key(Arc::clone(&backend.root_key)),
        Some(der) => {
            let mut cert_store = RootCertStore::empty();
            cert_store
                .add(der.clone())
                .inspect_err(|err| debug!("Unable to add deamon cert to temp. trust store for connection test: {err:?}"))
                .map_err(|_err| <E as FromInternalDaemonKeyInvalid>::from())?;

            sdk_builder.with_custom_cert_store(Arc::new(cert_store))
        }
    };
    let sdk = sdk_builder
        .with_backend_key(Arc::clone(&backend.key))
        .with_url(base_url.clone())
        .with_user_key(backend.user_key.clone())
        .build();

    let result = sdk.connection_test().await;
    let Err(ConnectionTestError::AwaitingSetup) = result else {
        debug!("Connection test failed, Expected Err(AwaitingSetup), Got: {result:?}");
        return Err(<E as FromInternalDaemonUnreachable>::from());
    };
    Ok(())
}
