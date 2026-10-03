use anyhow::anyhow;
use core::fmt::Display;
use core::net::SocketAddr;
use core::str::FromStr;
use database_agent_common::types::{DatabaseType, StoredInstanceCreate, VolumeMapping};
use oauth2::{AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl};
use rusty_s3::{Bucket, Credentials, UrlStyle};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
use url::Url;

const DEFAULT_SESSION_LIFETIME: u64 = 43200;
const DEFAULT_SESSION_ABSOLUTE_LIFETIME: u64 = 2_592_000;
const DEFAULT_AUTH_PROVIDER: &str = "user";
const DEFAULT_LOGO_UPLOAD_STRATEGY: &str = "s3";

fn var(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.is_empty())
}

fn required_var(key: &str) -> Result<String, anyhow::Error> {
    var(key).ok_or_else(|| anyhow!("{key} must be set"))
}

fn flag_var(key: &str, fallback: bool) -> bool {
    var(key).map_or(fallback, |value| {
        value.eq_ignore_ascii_case("1") || value.eq_ignore_ascii_case("true")
    })
}

fn parse_var<T>(key: &str) -> Result<Option<T>, anyhow::Error>
where
    T: FromStr,
    T::Err: Display,
{
    var(key)
        .map(|value| {
            value
                .parse::<T>()
                .map_err(|err| anyhow!("{key} is not a valid value: {err}"))
        })
        .transpose()
}

fn required_parse_var<T>(key: &str) -> Result<T, anyhow::Error>
where
    T: FromStr,
    T::Err: Display,
{
    parse_var(key)?.ok_or_else(|| anyhow!("{key} must be set"))
}

fn parse_list_var<T>(key: &str) -> Result<Vec<T>, anyhow::Error>
where
    T: FromStr,
    T::Err: Display,
{
    var(key).map_or_else(
        || Ok(Vec::new()),
        |value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(|entry| {
                    entry
                        .parse::<T>()
                        .map_err(|err| anyhow!("{key} contains an invalid entry `{entry}`: {err}"))
                })
                .collect()
        },
    )
}

fn role_set_var(key: &str) -> Result<HashSet<String>, anyhow::Error> {
    Ok(parse_list_var::<String>(key)?
        .into_iter()
        .map(|role| role.to_lowercase())
        .collect())
}

fn url_var(key: &str) -> Result<Option<Url>, anyhow::Error> {
    parse_var::<Url>(key)
}

fn required_url_var(key: &str) -> Result<Url, anyhow::Error> {
    required_parse_var::<Url>(key)
}

#[derive(Debug, Clone)]
pub struct BackendConfig {
    pub listeners: HashSet<SocketAddr>,
    pub public_url: Url,
    pub trusted_urls: Vec<Url>,
    pub session_lifetime: u64,
    pub session_absolute_lifetime: u64,
    pub auth: AuthConfig,
    pub database_url: String,
    pub cache_url: String,
    pub skip_template_cache_update: bool,
    pub resources: ResourceConfig,
    pub routes: RouteConfig,
    pub databases: DatabaseConfig,
    pub projects: ProjectPolicyConfig,
    pub logos: LogoConfig,
}

impl BackendConfig {
    pub fn from_env() -> Result<Self, anyhow::Error> {
        let listeners: HashSet<SocketAddr> = parse_list_var::<SocketAddr>("BACKEND_LISTENERS")?
            .into_iter()
            .collect();
        if listeners.is_empty() {
            return Err(anyhow!(
                "BACKEND_LISTENERS must be set to at least one socket address"
            ));
        }

        let session_lifetime =
            parse_var::<u64>("BACKEND_SESSION_LIFETIME")?.unwrap_or(DEFAULT_SESSION_LIFETIME);

        Ok(Self {
            listeners,
            public_url: required_url_var("BACKEND_PUBLIC_URL")?,
            trusted_urls: parse_list_var::<Url>("BACKEND_TRUSTED_URLS")?,
            session_lifetime,
            session_absolute_lifetime: parse_var::<u64>("BACKEND_SESSION_MAX_LIFETIME")?
                .unwrap_or(DEFAULT_SESSION_ABSOLUTE_LIFETIME)
                .max(session_lifetime),
            auth: AuthConfig::from_env()?,
            database_url: required_var("BACKEND_DATABASE_URL")?,
            cache_url: required_var("BACKEND_CACHE_URL")?,
            skip_template_cache_update: flag_var("BACKEND_SKIP_TEMPLATE_CACHE_UPDATE", false),
            resources: ResourceConfig::from_env(),
            routes: RouteConfig::from_env()?,
            databases: DatabaseConfig::from_env()?,
            projects: ProjectPolicyConfig::from_env(),
            logos: LogoConfig::from_env()?,
        })
    }

    pub fn cookie_secure(&self) -> bool {
        self.public_url.scheme() == "https"
    }

    pub fn allowed_origins(&self) -> Vec<url::Origin> {
        core::iter::once(self.public_url.origin())
            .chain(self.trusted_urls.iter().map(Url::origin))
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ProjectPolicyConfig {
    pub self_creation: bool,
    pub self_update: bool,
}

impl ProjectPolicyConfig {
    fn from_env() -> Self {
        Self {
            self_creation: flag_var("BACKEND_SELF_ORG_CREATION", true),
            self_update: flag_var("BACKEND_SELF_ORG_UPDATE", true),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LogoConfig {
    pub trusted_urls: Vec<Url>,
    pub upload: Option<LogoUpload>,
}

impl LogoConfig {
    fn from_env() -> Result<Self, anyhow::Error> {
        let strategy = var("BACKEND_LOGO_UPLOAD_STRATEGY")
            .unwrap_or_else(|| DEFAULT_LOGO_UPLOAD_STRATEGY.to_owned())
            .to_lowercase();

        let upload = match strategy.as_str() {
            "s3" => S3Config::from_env()?.map(LogoUpload::S3),
            other => {
                return Err(anyhow!(
                    "BACKEND_LOGO_UPLOAD_STRATEGY is not a valid value: unknown strategy `{other}`"
                ));
            }
        };

        Ok(Self {
            trusted_urls: parse_list_var::<Url>("BACKEND_LOGO_TRUSTED_URLS")?,
            upload,
        })
    }

    pub fn is_trusted(&self, url: &Url) -> bool {
        self.trusted_urls
            .iter()
            .chain(self.upload.iter().map(LogoUpload::public_url))
            .any(|trusted| url_within(url, trusted))
    }
}

fn url_within(url: &Url, base: &Url) -> bool {
    url.scheme() == base.scheme()
        && url.host() == base.host()
        && url.port_or_known_default() == base.port_or_known_default()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .path()
            .strip_prefix(base.path().trim_end_matches('/'))
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

#[derive(Debug, Clone)]
pub enum LogoUpload {
    S3(S3Config),
}

impl LogoUpload {
    pub const fn public_url(&self) -> &Url {
        match self {
            Self::S3(s3) => &s3.public_url,
        }
    }
}

#[derive(Debug, Clone)]
pub struct S3Config {
    pub bucket: Bucket,
    pub credentials: Credentials,
    pub public_url: Url,
}

impl S3Config {
    fn from_env() -> Result<Option<Self>, anyhow::Error> {
        let Some(endpoint) = url_var("BACKEND_LOGO_S3_ENDPOINT")? else {
            return Ok(None);
        };

        let style = if flag_var("BACKEND_LOGO_S3_PATH_STYLE", true) {
            UrlStyle::Path
        } else {
            UrlStyle::VirtualHost
        };

        let bucket = Bucket::new(
            endpoint,
            style,
            required_var("BACKEND_LOGO_S3_BUCKET")?,
            required_var("BACKEND_LOGO_S3_REGION")?,
        )
        .map_err(|err| anyhow!("BACKEND_LOGO_S3_ENDPOINT is not a valid value: {err}"))?;

        Ok(Some(Self {
            bucket,
            credentials: Credentials::new(
                required_var("BACKEND_LOGO_S3_ACCESS_KEY")?,
                required_var("BACKEND_LOGO_S3_SECRET_KEY")?,
            ),
            public_url: required_url_var("BACKEND_LOGO_S3_PUBLIC_URL")?,
        }))
    }
}

#[derive(Debug, Clone, Default)]
pub struct ResourceConfig {
    pub curseforge_api_key: Option<String>,
}

impl ResourceConfig {
    fn from_env() -> Self {
        Self {
            curseforge_api_key: var("BACKEND_CURSEFORGE_API_KEY"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    defaults: HashMap<DatabaseType, InstanceDefaults>,
}

impl DatabaseConfig {
    fn from_env() -> Result<Self, anyhow::Error> {
        let mut defaults = HashMap::new();

        for kind in DatabaseType::ALL {
            let prefix = format!("BACKEND_DB_{}", kind.as_str().to_uppercase());
            if !flag_var(&format!("{prefix}_ENABLED"), true) {
                continue;
            }

            let mut entry = InstanceDefaults::builtin(*kind);
            if let Some(image) = var(&format!("{prefix}_IMAGE")) {
                entry.image = image;
            }
            if let Some(memory) = parse_var::<i64>(&format!("{prefix}_MEMORY"))? {
                entry.memory = memory;
            }
            if let Some(swap) = parse_var::<i64>(&format!("{prefix}_SWAP"))? {
                entry.swap = swap;
            }
            if let Some(disk) = parse_var::<i64>(&format!("{prefix}_DISK"))? {
                entry.disk = disk;
            }
            if let Some(cpu) = parse_var::<f64>(&format!("{prefix}_CPU"))? {
                entry.cpu = cpu;
            }

            defaults.insert(*kind, entry);
        }

        Ok(Self { defaults })
    }

    pub fn defaults_for(&self, kind: DatabaseType) -> Option<&InstanceDefaults> {
        self.defaults.get(&kind)
    }
}

#[derive(Debug, Clone)]
pub struct InstanceDefaults {
    pub image: String,
    pub image_uid: u32,
    pub image_gid: u32,
    pub socket_path: String,
    pub memory: i64,
    pub swap: i64,
    pub disk: i64,
    pub cpu: f64,
    pub volumes: BTreeMap<String, String>,
    pub env: BTreeMap<String, String>,
    pub cmd: Option<Vec<String>>,
}

impl InstanceDefaults {
    fn builtin(kind: DatabaseType) -> Self {
        match kind {
            DatabaseType::Postgres => Self {
                image: "postgres:18-alpine".to_owned(),
                image_uid: 70,
                image_gid: 70,
                socket_path: "/var/run/postgresql/.s.PGSQL.5432".to_owned(),
                memory: 1024,
                swap: 0,
                disk: 10240,
                cpu: 1.0f64,
                volumes: BTreeMap::from([("data".to_owned(), "/var/lib/postgresql".to_owned())]),
                env: BTreeMap::from([
                    ("POSTGRES_HOST_AUTH_METHOD".to_owned(), "trust".to_owned()),
                    ("PGDATA".to_owned(), "/var/lib/postgresql/data".to_owned()),
                ]),
                cmd: None,
            },
            DatabaseType::Mariadb => Self {
                image: "mariadb:11".to_owned(),
                image_uid: 999,
                image_gid: 999,
                socket_path: "/run/mysqld/mysqld.sock".to_owned(),
                memory: 1024,
                swap: 0,
                disk: 10240,
                cpu: 1.0f64,
                volumes: BTreeMap::from([("data".to_owned(), "/var/lib/mysql".to_owned())]),
                env: BTreeMap::from([(
                    "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD".to_owned(),
                    "1".to_owned(),
                )]),
                cmd: None,
            },
            DatabaseType::Mongodb => Self {
                image: "mongo:8".to_owned(),
                image_uid: 999,
                image_gid: 999,
                socket_path: "/run/mongodb/mongodb-27017.sock".to_owned(),
                memory: 1024,
                swap: 0,
                disk: 10240,
                cpu: 1.0f64,
                volumes: BTreeMap::from([("data".to_owned(), "/data/db".to_owned())]),
                env: BTreeMap::new(),
                cmd: Some(vec![
                    "mongod".to_owned(),
                    "--auth".to_owned(),
                    "--unixSocketPrefix=/run/mongodb".to_owned(),
                ]),
            },
            DatabaseType::Redis => Self {
                image: "redis:8-alpine".to_owned(),
                image_uid: 999,
                image_gid: 999,
                socket_path: "/run/redis/redis.sock".to_owned(),
                memory: 512,
                swap: 0,
                disk: 2048,
                cpu: 1.0f64,
                volumes: BTreeMap::from([("data".to_owned(), "/data".to_owned())]),
                env: BTreeMap::new(),
                cmd: Some(vec![
                    "redis-server".to_owned(),
                    "--unixsocket".to_owned(),
                    "/run/redis/redis.sock".to_owned(),
                    "--port".to_owned(),
                    "0".to_owned(),
                ]),
            },
        }
    }

    pub fn to_create(&self, kind: DatabaseType) -> StoredInstanceCreate {
        StoredInstanceCreate {
            database_type: kind,
            suspended: false,
            memory: self.memory,
            swap: self.swap,
            disk: self.disk,
            io_weight: None,
            cpu: self.cpu,
            image: self.image.clone(),
            image_uid: self.image_uid,
            image_gid: self.image_gid,
            volumes: VolumeMapping(self.volumes.clone()),
            socket_path: self.socket_path.clone(),
            timezone: None,
            env: self.env.clone(),
            cmd: self.cmd.clone(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RouteConfig {
    pub cloudflare: Option<CloudflareConfig>,
    pub pangolin: Option<PangolinConfig>,
}

impl RouteConfig {
    fn from_env() -> Result<Self, anyhow::Error> {
        let cloudflare = var("BACKEND_CLOUDFLARE_API_TOKEN")
            .map(|api_token| {
                Ok::<_, anyhow::Error>(CloudflareConfig {
                    api_token,
                    ttl: parse_var::<u32>("BACKEND_CLOUDFLARE_TTL")?,
                    api_url: url_var("BACKEND_CLOUDFLARE_API_URL")?,
                })
            })
            .transpose()?;

        let pangolin = url_var("BACKEND_PANGOLIN_API_URL")?
            .map(|api_url| {
                Ok::<_, anyhow::Error>(PangolinConfig {
                    api_url,
                    api_key: required_var("BACKEND_PANGOLIN_API_KEY")?,
                    org_id: required_var("BACKEND_PANGOLIN_ORG_ID")?,
                    site_id: required_parse_var::<i64>("BACKEND_PANGOLIN_SITE_ID")?,
                })
            })
            .transpose()?;

        Ok(Self {
            cloudflare,
            pangolin,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CloudflareConfig {
    pub api_token: String,
    pub ttl: Option<u32>,
    pub api_url: Option<Url>,
}

#[derive(Debug, Clone)]
pub struct PangolinConfig {
    pub api_url: Url,
    pub api_key: String,
    pub org_id: String,
    pub site_id: i64,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub providers: HashMap<String, OAuthProviderConfig>,
}

impl AuthConfig {
    fn from_env() -> Result<Self, anyhow::Error> {
        let name = var("BACKEND_AUTH_PROVIDER")
            .unwrap_or_else(|| DEFAULT_AUTH_PROVIDER.to_owned())
            .to_lowercase();

        let provider = OAuthProviderConfig {
            auth_url: AuthUrl::new(required_var("BACKEND_AUTH_AUTHORIZE_URL")?)
                .map_err(|err| anyhow!("BACKEND_AUTH_AUTHORIZE_URL is not a valid url: {err}"))?,
            token_url: TokenUrl::new(required_var("BACKEND_AUTH_TOKEN_URL")?)
                .map_err(|err| anyhow!("BACKEND_AUTH_TOKEN_URL is not a valid url: {err}"))?,
            redirect_url: RedirectUrl::new(required_var("BACKEND_AUTH_REDIRECT_URL")?)
                .map_err(|err| anyhow!("BACKEND_AUTH_REDIRECT_URL is not a valid url: {err}"))?,
            userinfo_url: required_url_var("BACKEND_AUTH_USERINFO_URL")?,
            client_id: ClientId::new(required_var("BACKEND_AUTH_CLIENT_ID")?),
            client_secret: ClientSecret::new(required_var("BACKEND_AUTH_CLIENT_SECRET")?),
            admin_roles: role_set_var("BACKEND_AUTH_ADMIN_ROLES")?,
            moderator_roles: role_set_var("BACKEND_AUTH_MODERATOR_ROLES")?,
        };

        Ok(Self {
            providers: HashMap::from([(name, provider)]),
        })
    }
}

#[derive(Debug, Clone)]
pub struct OAuthProviderConfig {
    pub auth_url: AuthUrl,
    pub token_url: TokenUrl,
    pub redirect_url: RedirectUrl,
    pub userinfo_url: Url,
    pub client_id: ClientId,
    pub client_secret: ClientSecret,
    pub admin_roles: HashSet<String>,
    pub moderator_roles: HashSet<String>,
}

#[cfg(test)]
mod tests {
    use super::url_within;
    use url::Url;

    fn within(url: &str, base: &str) -> bool {
        url_within(
            &Url::parse(url).expect("url"),
            &Url::parse(base).expect("base"),
        )
    }

    #[test]
    fn accepts_urls_below_the_base() {
        assert!(within("https://i.imgur.com/abc.png", "https://i.imgur.com"));
        assert!(within(
            "https://s3.example.com/logos/a/b.png",
            "https://s3.example.com/logos/"
        ));
    }

    #[test]
    fn rejects_other_hosts_schemes_and_ports() {
        assert!(!within("https://evil.com/abc.png", "https://i.imgur.com"));
        assert!(!within(
            "https://i.imgur.com.evil.com/abc.png",
            "https://i.imgur.com"
        ));
        assert!(!within("http://i.imgur.com/abc.png", "https://i.imgur.com"));
        assert!(!within(
            "https://i.imgur.com:8443/abc.png",
            "https://i.imgur.com"
        ));
        assert!(!within(
            "https://i.imgur.com@evil.com/abc.png",
            "https://i.imgur.com"
        ));
        assert!(!within(
            "https://user@i.imgur.com/abc.png",
            "https://i.imgur.com"
        ));
    }

    #[test]
    fn rejects_paths_outside_the_prefix() {
        assert!(!within(
            "https://s3.example.com/logos-other/a.png",
            "https://s3.example.com/logos"
        ));
        assert!(!within(
            "https://s3.example.com/logos/../private/a.png",
            "https://s3.example.com/logos"
        ));
    }
}
