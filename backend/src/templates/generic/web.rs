use daemon_common::service::server::{ServerBuildImage, ServerBuildPayload};
use indexmap::IndexSet;
use redis::RedisError;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use speedy::{Readable, Writable};
use std::collections::{HashMap, HashSet};
use tracing::debug;

use crate::db::server::ports::{NetworkProtocol, ServerPort};
use crate::templates::generic::{
    GitFields, RepositoryURL, git_environment, git_variable_group, parse_git_fields,
};
use crate::templates::utils::{RELATIVE_PATH_REGEX, embed_script, is_relative_path};
use crate::templates::variable::{VariableBuilder, VariableGroupBuilder, VariablePayload};
use crate::templates::{Template, TemplateError, TemplatePortDefinition, ThinTemplateError};

const HTTP_PORT: u16 = 8080;
const HTTP_PORT_NAME: &str = "http";
const PHP_DISABLED: &str = "Disabled";
const PHP_VERSIONS: [&str; 5] = ["8.5", "8.4", "8.3", "8.2", "8.1"];
const STATIC_BASE_IMAGE: &str = "debian:trixie-slim";
const ENTRYPOINT_PATH: &str = "/usr/local/bin/web-entrypoint";
const REL: usize = 2;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WebServer {
    Nginx,
    Apache,
}

impl WebServer {
    const ALL: [Self; 2] = [Self::Nginx, Self::Apache];

    const fn package(self) -> &'static str {
        match self {
            Self::Nginx => "nginx",
            Self::Apache => "apache2",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::Nginx => "Nginx",
            Self::Apache => "Apache",
        }
    }

    fn from_label(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|server| server.label() == value)
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct WebExtra {
    web_server: WebServer,
    php_version: Option<String>,
    composer: bool,
    web_root: String,
    repository_url: RepositoryURL,
    repository_branch: String,
    #[serde(default)]
    repository_username: String,
    #[serde(default)]
    repository_password: String,
}

impl WebExtra {
    fn image(&self) -> ServerBuildImage {
        let (base_image, runtime) = self.php_version.as_ref().map_or_else(
            || (STATIC_BASE_IMAGE.to_owned(), "static".to_owned()),
            |version| (format!("php:{version}-fpm"), format!("php{version}")),
        );

        ServerBuildImage {
            parents: Vec::new(),
            base: None,
            dockerfile: include_str!("web/Dockerfile")
                .replace("{BASE_IMAGE}", &base_image)
                .replace(
                    "{ENTRYPOINT_SCRIPT}",
                    &embed_script(ENTRYPOINT_PATH, include_str!("web/entrypoint.sh")),
                ),
            args: HashMap::from([(
                "WEB_SERVER".to_owned(),
                self.web_server.package().to_owned(),
            )]),
            tag: None,
            default_tag: Some(format!(
                "web-{}-{runtime}-r{REL}",
                self.web_server.package()
            )),
        }
    }
}

#[derive(Readable, Writable)]
pub(crate) struct WebCache;

pub(crate) struct WebTemplate;

impl Template for WebTemplate {
    const ID: &'static str = "web";
    type Extra = WebExtra;
    type Cache = WebCache;

    async fn extra_to_build_payload(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<ServerBuildPayload, TemplateError> {
        Ok(ServerBuildPayload {
            image: extra.image(),
            stop_command: None,
            stop_timeout: 30,
            uid: None,
            gid: None,
            backup_exclude: HashSet::from([".git/".to_owned(), ".composer/".to_owned()]),
            environment: git_environment(GitFields {
                url: extra.repository_url,
                branch: extra.repository_branch,
                username: extra.repository_username,
                password: extra.repository_password,
            })
            .into_iter()
            .chain([
                ("WEB_ROOT".to_owned(), extra.web_root),
                (
                    "COMPOSER_INSTALL".to_owned(),
                    if extra.composer { "1" } else { "0" }.to_owned(),
                ),
            ])
            .collect(),
            files_write: HashMap::new(),
            cap_add: Vec::new(),
            cap_drop: Vec::new(),
        })
    }

    async fn default_extra(&self, _cache: &Self::Cache) -> Result<Self::Extra, ThinTemplateError> {
        Ok(WebExtra {
            web_server: WebServer::Nginx,
            php_version: PHP_VERSIONS.first().map(|version| (*version).to_owned()),
            composer: true,
            web_root: "public".to_owned(),
            repository_url: RepositoryURL::Disabled,
            repository_branch: "HEAD".to_owned(),
            repository_username: String::new(),
            repository_password: String::new(),
        })
    }

    async fn default_ports(
        &self,
    ) -> Result<HashMap<String, TemplatePortDefinition>, ThinTemplateError> {
        Ok(HashMap::from([(
            HTTP_PORT_NAME.to_owned(),
            TemplatePortDefinition {
                protocol: NetworkProtocol::Tcp,
                internal_port: HTTP_PORT,
                placeholder: "HTTP".to_owned(),
                remappable: true,
                http: true,
            },
        )]))
    }

    async fn extra_to_variables(
        &self,
        _cache: &Self::Cache,
        extra: Self::Extra,
    ) -> Result<VariablePayload, TemplateError> {
        Ok(VariableBuilder::default()
            .group(
                VariableGroupBuilder::new(Some("Web Server"))
                    .static_variable(
                        "web_server",
                        "Web Server",
                        Some(extra.web_server.label()),
                        WebServer::ALL.iter().map(|server| server.label()).collect(),
                    )
                    .regex_variable(
                        "web_root",
                        "Web Root",
                        Some(extra.web_root),
                        RELATIVE_PATH_REGEX.as_str(),
                        "public",
                        false,
                    ),
            )
            .group(
                VariableGroupBuilder::new(Some("PHP"))
                    .static_variable(
                        "php_version",
                        "PHP Version",
                        Some(extra.php_version.as_deref().unwrap_or(PHP_DISABLED)),
                        core::iter::once(PHP_DISABLED)
                            .chain(PHP_VERSIONS)
                            .collect::<IndexSet<_>>(),
                    )
                    .checkbox_variable(
                        "composer",
                        "Composer",
                        Some(extra.composer),
                        "Run composer install on startup".to_owned(),
                    ),
            )
            .group(git_variable_group(GitFields {
                url: extra.repository_url,
                branch: extra.repository_branch,
                username: extra.repository_username,
                password: extra.repository_password,
            }))
            .into_payload())
    }

    async fn variables_to_extra_validated(
        &self,
        _cache: &Self::Cache,
        _old_extra: Self::Extra,
        variables: HashMap<String, String>,
    ) -> Result<Option<Self::Extra>, TemplateError> {
        let Some(web_server) = variables
            .get("web_server")
            .and_then(|value| WebServer::from_label(value))
        else {
            debug!("Variables rejected: web_server missing or invalid");
            return Ok(None);
        };

        let Some(php_version_raw) = variables.get("php_version") else {
            debug!("Variables rejected: php_version missing");
            return Ok(None);
        };
        let php_version = if php_version_raw == PHP_DISABLED {
            None
        } else if PHP_VERSIONS.contains(&php_version_raw.as_str()) {
            Some(php_version_raw.clone())
        } else {
            debug!("Variables rejected: php_version invalid");
            return Ok(None);
        };

        let Some(composer) = variables
            .get("composer")
            .and_then(|value| value.parse::<bool>().ok())
        else {
            debug!("Variables rejected: composer missing or invalid");
            return Ok(None);
        };

        let Some(web_root) = variables
            .get("web_root")
            .filter(|value| is_relative_path(value))
        else {
            debug!("Variables rejected: web_root missing or invalid");
            return Ok(None);
        };

        let Some(git) = parse_git_fields(&variables) else {
            return Ok(None);
        };

        Ok(Some(WebExtra {
            web_server,
            php_version,
            composer,
            web_root: web_root.clone(),
            repository_url: git.url,
            repository_branch: git.branch,
            repository_username: git.username,
            repository_password: git.password,
        }))
    }

    async fn enabled_features(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
    ) -> Result<HashSet<&'static str>, TemplateError> {
        Ok(HashSet::new())
    }

    async fn primary_port(
        &self,
        _cache: &Self::Cache,
        _extra: Self::Extra,
        ports: &HashMap<u32, ServerPort>,
    ) -> Option<(u32, ServerPort, u16)> {
        self.primary_port_named(ports, HTTP_PORT_NAME).await
    }

    fn default_internet_access(&self) -> bool {
        true
    }

    fn supports_custom_environment(&self) -> bool {
        true
    }

    async fn init(&self, _redis_client: ConnectionManager) -> Result<(), RedisError> {
        Ok(())
    }

    async fn update_cache() -> Result<Self::Cache, ()> {
        Ok(WebCache)
    }

    fn cache_update_needed(_cache: &Self::Cache) -> bool {
        false
    }
}
