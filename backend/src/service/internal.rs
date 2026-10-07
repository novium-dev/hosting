use super::*;
use crate::db::node::insert_storages;
use crate::registration::{DatabaseHostRegistration, NodeRegistration};
use crate::service::internal::internal_service_error::{AuthPasswordError, AuthPublickeyError};
use crate::{
    Backend,
    auth::permissions::{ManagementPermissions, ProjectPermissions, Role, ServerPermissions},
    service::internal::{
        error_internal_daemon_key_invalid::FromInternalDaemonKeyInvalid,
        error_internal_daemon_unreachable::FromInternalDaemonUnreachable,
        internal_service_error::{
            DaemonConfigError, DaemonRegisterError, DaemonRootKeyError, DatabaseAgentConfigError,
            DatabaseAgentRegisterError, DatabaseAgentRootKeyError,
        },
    },
};
use axum_extra::headers::authorization::Basic;
use axum_extra::{
    TypedHeader,
    headers::{Authorization, authorization::Bearer},
};
use daemon_common::DAEMON_KEY_PREFIX;
use daemon_common::node::{BackendAuthServerPermissions, SetupNodeConfig};
use daemon_common::ssh::{DaemonBackendAuthResponse, DaemonBackendAuthServer};
use daemon_common::{
    key::rcgen::{CertificateSigningRequestParams, DnType, DnValue},
    node::NodeRegistrationRequest,
    sdk::DaemonSDK,
    service::setup::{SetupService as _, setup_service_error::ConfigError},
};
use database_agent_common::AGENT_KEY_PREFIX;
use database_agent_common::sdk::DatabaseAgentSDK;
use database_agent_common::service::setup::{
    SetupService as _, setup_service_error::ConfigError as AgentConfigError,
};
use database_agent_common::types::{AgentRegistrationRequest, SetupAgentConfig};
use rustls::{
    RootCertStore,
    pki_types::{CertificateDer, CertificateSigningRequestDer},
};
use sqlx::{Connection as _, query};
use std::sync::Arc;
use tracing::{debug, error};
use url::Url;
use uuid::Uuid;
use zelus::{define_header_variable, service};

define_header_variable!(generated_arg_1 "The authorization code for the registration");
define_header_variable!(generated_arg_2 "The authorizations credentials of the user");

define_error!(internal_daemon {
    key_invalid("Invalid key for certificate request" BAD_REQUEST),
    unreachable("Connection test failed" BAD_GATEWAY),
    sign_failed("Unable to sign daemon key" INTERNAL_SERVER_ERROR),
    mismatch("Registration request does not match the assigned node config" BAD_REQUEST)
});

define_query_variable!(
    node "The node ID"
);

#[service(path = "/internal", tag = "internal", no_sdk)]
pub(crate) impl InternalService for Backend {
    /// Returns the public daemon root key as pem.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/daemon/root_key", no_auth)]
    #[error(auth::invalid, cache::failure <- [redis:*])]
    async fn daemon_root_key(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
    ) -> Result<String, _> {
        self.registration::<NodeRegistration>(auth.token())
            .await?
            .ok_or(DaemonRootKeyError::AuthInvalid)?;
        Ok(self.root_key.dump(None, None))
    }

    /// Returns the intended logical [`NodeConfig`] for a pending node registration.
    ///
    /// The daemon pulls this during setup (between `root_key` and `register`) to
    /// build its local config. The response carries database credentials, so it
    /// is served only over TLS and gated strictly behind the setup code.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/daemon/config", no_auth)]
    #[error(auth::invalid, cache::failure <- [redis:*])]
    async fn daemon_config(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
    ) -> Result<SetupNodeConfig, _> {
        self.registration::<NodeRegistration>(auth.token())
            .await?
            .map(|registration| registration.config)
            .ok_or(DaemonConfigError::AuthInvalid)
    }

    /// Registers a new daemon.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/daemon/register", method = POST, raw, no_auth)]
    #[error(internal_daemon::{key_invalid, unreachable, sign_failed, mismatch}, db::failure <- [sql:*], cache::failure <- [redis:*], auth::invalid)]
    async fn daemon_register(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
        NodeRegistrationRequest {
            cert,
            csr,
            default_bind,
        }: NodeRegistrationRequest,
    ) -> Result<Vec<u8>, _> {
        if let Some(registration) = self
            .claim_registration::<NodeRegistration>(auth.token())
            .await?
        {
            let cert = CertificateDer::from(cert);

            let config = registration.config;
            let default_host = registration.default_host.clone();
            let ssh_host = config
                .ssh
                .as_ref()
                .map(|endpoint| endpoint.host.to_string());
            let ssh_port = config.ssh.as_ref().map(|endpoint| i32::from(endpoint.port));

            daemon_connection_test::<DaemonRegisterError>(
                Uuid::nil(),
                &config.base_url,
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
            if !common_name.eq(&DnValue::from(DAEMON_KEY_PREFIX)) {
                return Err(DaemonRegisterError::InternalDaemonKeyInvalid);
            }

            let uuid = Uuid::new_v4();
            let signed = self
                .root_key
                .sign_daemon_key(&self.root_privkey, csr.public_key, DAEMON_KEY_PREFIX, uuid)
                .inspect_err(|err| error!("Unable to sign daemon cert: {err:?}"))
                .map_err(|_err| DaemonRegisterError::InternalDaemonSignFailed)?;

            let backend = self.clone();
            let mut conn = self.database.acquire().await?;
            conn.transaction(|tx| {
                Box::pin(async move {
                    query!(
                        "INSERT INTO nodes (id, display, url, default_bind, default_host, ssh_host, ssh_port)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)",
                        &uuid,
                        registration.name,
                        config.base_url.as_str(),
                        &default_bind,
                        &default_host,
                        ssh_host,
                        ssh_port
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to insert node: {err:?}"))?;

                    insert_storages(
                        tx,
                        &uuid,
                        config.storages.keys().cloned().collect(),
                        config.backups.keys().cloned().collect(),
                    )
                    .await?;

                    backend.sync_nodes(tx).await?;

                    Ok(signed.to_vec())
                })
            })
            .await
        } else {
            Err(DaemonRegisterError::AuthInvalid)
        }
    }

    /// Returns the public daemon root key as pem.
    ///
    /// This route should only be used directly by the database agent.
    #[route("/database_agent/root_key", no_auth)]
    #[error(auth::invalid, cache::failure <- [redis:*])]
    async fn database_agent_root_key(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
    ) -> Result<String, _> {
        self.registration::<DatabaseHostRegistration>(auth.token())
            .await?
            .ok_or(DatabaseAgentRootKeyError::AuthInvalid)?;
        Ok(self.root_key.dump(None, None))
    }

    /// Returns the intended logical config for a pending database host registration.
    ///
    /// The agent pulls this during setup (between `root_key` and `register`) to
    /// build its local config.
    ///
    /// This route should only be used directly by the database agent.
    #[route("/database_agent/config", no_auth)]
    #[error(auth::invalid, cache::failure <- [redis:*])]
    async fn database_agent_config(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
    ) -> Result<SetupAgentConfig, _> {
        self.registration::<DatabaseHostRegistration>(auth.token())
            .await?
            .map(|registration| registration.config)
            .ok_or(DatabaseAgentConfigError::AuthInvalid)
    }

    /// Registers a new database agent.
    ///
    /// This route should only be used directly by the database agent.
    #[route("/database_agent/register", method = POST, raw, no_auth)]
    #[error(internal_daemon::{key_invalid, unreachable, sign_failed}, db::failure <- [sql:*], cache::failure <- [redis:*], auth::invalid)]
    async fn database_agent_register(
        &self,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Bearer>>,
        AgentRegistrationRequest { cert, csr }: AgentRegistrationRequest,
    ) -> Result<Vec<u8>, _> {
        if let Some(registration) = self
            .claim_registration::<DatabaseHostRegistration>(auth.token())
            .await?
        {
            let cert = CertificateDer::from(cert);
            let config = registration.config;

            database_agent_connection_test::<DatabaseAgentRegisterError>(
                Uuid::nil(),
                &config.base_url,
                self,
                &cert,
            )
            .await?;

            let csr = CertificateSigningRequestDer::from(csr);
            let csr = CertificateSigningRequestParams::from_der(&csr)
                .map_err(|_err| DatabaseAgentRegisterError::InternalDaemonKeyInvalid)?;
            let Some(common_name) = csr.params.distinguished_name.get(&DnType::CommonName) else {
                return Err(DatabaseAgentRegisterError::InternalDaemonKeyInvalid);
            };
            if !common_name.eq(&DnValue::from(AGENT_KEY_PREFIX)) {
                return Err(DatabaseAgentRegisterError::InternalDaemonKeyInvalid);
            }

            let uuid = Uuid::new_v4();
            let signed = self
                .root_key
                .sign_daemon_key(&self.root_privkey, csr.public_key, AGENT_KEY_PREFIX, uuid)
                .inspect_err(|err| error!("Unable to sign database agent cert: {err:?}"))
                .map_err(|_err| DatabaseAgentRegisterError::InternalDaemonSignFailed)?;

            let backend = self.clone();
            let mut conn = self.database.acquire().await?;
            conn.transaction(|tx| {
                Box::pin(async move {
                    query!(
                        "INSERT INTO database_hosts (id, display, url, public_host) VALUES ($1, $2, $3, $4)",
                        &uuid,
                        registration.display,
                        config.base_url.as_str(),
                        registration.public_host
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to insert database host: {err:?}"))?;

                    query!(
                        "INSERT INTO database_host_groups (host, group_id) SELECT $1, id FROM groups WHERE id = ANY($2)",
                        &uuid,
                        &registration.groups
                    )
                    .execute(&mut **tx)
                    .await
                    .inspect_err(|err| error!("Failed to insert database host groups: {err:?}"))?;

                    for (kind, port) in config.ports {
                        query!(
                            "INSERT INTO database_host_ports (host, kind, port) VALUES ($1, $2, $3)",
                            &uuid,
                            kind.as_str(),
                            i32::from(port)
                        )
                        .execute(&mut **tx)
                        .await
                        .inspect_err(|err| error!("Failed to insert database host port: {err:?}"))?;
                    }

                    backend.sync_database_hosts(tx).await?;

                    Ok(signed.to_vec())
                })
            })
            .await
        } else {
            Err(DatabaseAgentRegisterError::AuthInvalid)
        }
    }

    /// Authenticates an SFTP/SSH password login against a server's daemon password.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/auth/password", no_auth, query = [ node ])]
    #[error(auth::invalid, db::failure <- [sql:*])]
    async fn auth_password(
        &self,
        node: String,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Basic>>,
    ) -> Result<DaemonBackendAuthResponse, _> {
        let node = Uuid::parse_str(&node).map_err(|_err| AuthPasswordError::AuthInvalid)?;
        auth_servers_for_password(self, node, auth.username(), auth.password()).await
    }

    /// Authenticates an SFTP/SSH public-key login against a user's registered SSH keys.
    ///
    /// This route should only be used directly by the daemon.
    #[route("/auth/publickey", no_auth, query = [ node ])]
    #[error(auth::invalid, db::failure <- [sql:*])]
    async fn auth_publickey(
        &self,
        node: String,
        TypedHeader(Authorization(auth)): TypedHeader<Authorization<Basic>>,
    ) -> Result<DaemonBackendAuthResponse, _> {
        let node = Uuid::parse_str(&node).map_err(|_err| AuthPublickeyError::AuthInvalid)?;
        auth_servers_for_public_key(self, node, auth.username(), auth.password()).await
    }
}

async fn auth_servers_for_public_key(
    backend: &Backend,
    node: Uuid,
    username: &str,
    fingerprint_sha512: &str,
) -> Result<DaemonBackendAuthResponse, AuthPublickeyError> {
    if fingerprint_sha512.len() != 128
        || !fingerprint_sha512
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AuthPublickeyError::AuthInvalid);
    }

    let Some(user) = query!(
        r#"SELECT DISTINCT users.id, users.role
         FROM users
         JOIN user_ssh_keys ON user_ssh_keys."user" = users.id
         WHERE users.username = $1
           AND user_ssh_keys.fingerprint_sha512 = $2
         LIMIT 1"#,
        username,
        fingerprint_sha512
    )
    .fetch_optional(&*backend.database)
    .await?
    else {
        return Err(AuthPublickeyError::AuthInvalid);
    };

    auth_servers_for_user(backend, node, user.id, user.role).await
}

async fn auth_servers_for_password(
    backend: &Backend,
    node: Uuid,
    username: &str,
    password: &str,
) -> Result<DaemonBackendAuthResponse, AuthPasswordError> {
    if password.len() != 32 {
        return Err(AuthPasswordError::AuthInvalid);
    }

    let Some(user) = query!(
        "SELECT id, role
         FROM users
         WHERE username = $1
           AND daemon_password = $2
         LIMIT 1",
        username,
        password
    )
    .fetch_optional(&*backend.database)
    .await?
    else {
        return Err(AuthPasswordError::AuthInvalid);
    };

    auth_servers_for_user(backend, node, user.id, user.role).await
}

async fn auth_servers_for_user<E>(
    backend: &Backend,
    node: Uuid,
    user_id: i32,
    role_value: i32,
) -> Result<DaemonBackendAuthResponse, E>
where
    E: From<sqlx::Error>,
{
    let mut response = Vec::new();
    let role = u8::try_from(role_value)
        .ok()
        .and_then(|role| Role::try_from(role).ok())
        .unwrap_or(Role::User);
    let role_permissions = role.project_permissions().bits() | role.server_permissions().bits();

    let server_records = query!(
        r#"SELECT
            servers.name,
            servers.node_server_id,
            servers.suspended AS "suspended: bool",
            nodes.maintenance AS "maintenance: bool",
            projects.owner,
            project_users.permissions AS "permissions?"
         FROM servers
         JOIN nodes ON nodes.id = servers.node
         JOIN projects ON projects.id = servers.project
         LEFT JOIN project_users
            ON project_users.project = servers.project
            AND project_users."user" = $1
            AND (project_users.expires_at IS NULL OR project_users.expires_at > now())
         WHERE servers.node = $2
            AND (
                projects.owner = $3
                OR project_users."user" IS NOT NULL
                OR $4
            )
         ORDER BY servers.node_server_id"#,
        user_id,
        node,
        user_id,
        ProjectPermissions::from_bits_retain(role_permissions).contains(ProjectPermissions::VIEW)
    )
    .fetch_all(&*backend.database)
    .await?;

    for server in server_records {
        let project_permissions = server.permissions;
        let owner = server.owner;
        let suspended = server.suspended;
        let maintenance = server.maintenance;

        let permissions = if owner == user_id {
            ProjectPermissions::all().bits() | ServerPermissions::all().bits()
        } else {
            project_permissions.unwrap_or(role_permissions)
        };

        let permissions = if (suspended
            && !role
                .management_permissions()
                .contains(ManagementPermissions::SERVER_SUSPEND))
            || (maintenance
                && !role
                    .management_permissions()
                    .contains(ManagementPermissions::SERVER_MANAGE))
        {
            ProjectPermissions::VIEW.bits()
        } else {
            permissions
        };

        if ProjectPermissions::from_bits_retain(permissions).contains(ProjectPermissions::VIEW) {
            response.push(DaemonBackendAuthServer {
                id: server.node_server_id.cast_unsigned(),
                name: server.name,
                permissions: daemon_auth_permissions(permissions),
            });
        }
    }

    Ok(response)
}

fn daemon_auth_permissions(permissions: i64) -> BackendAuthServerPermissions {
    let server_permissions = ServerPermissions::from_bits_retain(permissions);

    let mut daemon_permissions = BackendAuthServerPermissions::empty();
    if server_permissions.grants(ServerPermissions::TERMINAL_READ) {
        daemon_permissions |= BackendAuthServerPermissions::TERMINAL_READ;
    }
    if server_permissions.grants(ServerPermissions::TERMINAL_WRITE) {
        daemon_permissions |= BackendAuthServerPermissions::TERMINAL_WRITE;
    }
    if server_permissions.grants(ServerPermissions::FILES_READ) {
        daemon_permissions |= BackendAuthServerPermissions::FILES_READ;
    }
    if server_permissions.grants(ServerPermissions::FILES_WRITE) {
        daemon_permissions |= BackendAuthServerPermissions::FILES_WRITE;
    }
    if server_permissions.grants(ServerPermissions::BACKUP_DOWNLOAD) {
        daemon_permissions |= BackendAuthServerPermissions::BACKUP_DOWNLOAD;
    }
    daemon_permissions
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
                .inspect_err(|err| debug!("Unable to add daemon cert to temp. trust store for connection test: {err:?}"))
                .map_err(|_err| <E as FromInternalDaemonKeyInvalid>::from())?;

            sdk_builder.with_custom_cert_store(Arc::new(cert_store))
        }
    };
    let sdk = sdk_builder
        .with_backend_key(Arc::clone(&backend.key))
        .with_url(base_url.clone())
        .with_user_key(backend.user_key.clone())
        .build();

    let result = sdk.config().await;
    let Err(ConfigError::AwaitingSetup) = result else {
        debug!("Connection test failed, Expected Err(AwaitingSetup), Got: {result:?}");
        return Err(<E as FromInternalDaemonUnreachable>::from());
    };
    Ok(())
}

async fn database_agent_connection_test<
    E: FromInternalDaemonUnreachable + FromInternalDaemonKeyInvalid,
>(
    identifier: Uuid,
    base_url: &Url,
    backend: &Backend,
    trust: &CertificateDer<'static>,
) -> Result<(), E> {
    let mut cert_store = RootCertStore::empty();
    cert_store
        .add(trust.clone())
        .inspect_err(|err| {
            debug!("Unable to add agent cert to temp. trust store for connection test: {err:?}");
        })
        .map_err(|_err| <E as FromInternalDaemonKeyInvalid>::from())?;

    let sdk = DatabaseAgentSDK::builder()
        .with_identifier(identifier)
        .with_custom_cert_store(Arc::new(cert_store))
        .with_backend_key(Arc::clone(&backend.key))
        .with_url(base_url.clone())
        .build();

    let result = sdk.config().await;
    let Err(AgentConfigError::AwaitingSetup) = result else {
        debug!("Connection test failed, Expected Err(AwaitingSetup), Got: {result:?}");
        return Err(<E as FromInternalDaemonUnreachable>::from());
    };
    Ok(())
}
