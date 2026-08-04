use crate::config::AgentConfig;
use anyhow::Context as _;
use bollard::Docker;
use bollard::auth::DockerCredentials;
use bollard::errors::Error::DockerResponseServerError;
use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
use bollard::models::{
    ContainerCreateBody, ContainerInspectResponse, ContainerStateStatusEnum, ContainerUpdateBody,
    HostConfig, HostConfigLogConfig, Mount, MountType, Resources,
};
use bollard::query_parameters::{
    CreateContainerOptions, CreateImageOptions, KillContainerOptions, ListContainersOptions,
    ListImagesOptions, LogsOptions, RemoveContainerOptions, StartContainerOptions,
    StatsOptions, StopContainerOptions,
};
use bytes::Bytes;
use core::pin::Pin;
use core::sync::atomic::Ordering;
use core::time::Duration;
use database_agent_common::types::{ContainerState, ResourceUsage, StoredInstance};
use futures_util::StreamExt as _;
use futures_util::stream::BoxStream;
use itertools::Itertools as _;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::AsyncWrite;
use tokio::task::JoinHandle;
use uuid::Uuid;

const SERVICE_LABEL: &str = "novium-database-agent";
const STOP_TIMEOUT: i32 = 30;

pub struct ExecOptions {
    pub command: Vec<String>,
}

impl ExecOptions {
    pub fn shell(script: String) -> Self {
        Self {
            command: vec!["sh".to_owned(), "-c".to_owned(), script],
        }
    }
}

pub struct ExecStream {
    pub output: BoxStream<'static, anyhow::Result<Bytes>>,
    pub stdin: Pin<Box<dyn AsyncWrite + Send>>,
}

pub async fn connect(config: &AgentConfig) -> anyhow::Result<Docker> {
    let socket = &config.docker.socket;
    let docker = if socket.starts_with("http://") || socket.starts_with("tcp://") {
        Docker::connect_with_http(socket, 120, bollard::API_DEFAULT_VERSION)
    } else {
        Docker::connect_with_local(socket, 120, bollard::API_DEFAULT_VERSION)
    }
    .context("failed to connect to docker")?;

    docker
        .version()
        .await
        .context("failed to query the docker version")?;

    for directory in [&config.socket_dir, &config.data_dir] {
        tokio::fs::create_dir_all(directory)
            .await
            .with_context(|| format!("failed to create {}", directory.display()))?;
    }

    Ok(docker)
}

fn resources(data: &StoredInstance, config: &AgentConfig) -> Resources {
    let memory = if data.memory > 0 {
        data.memory * 1024 * 1024
    } else {
        0
    };

    Resources {
        memory: (memory > 0).then_some(memory),
        memory_reservation: (memory > 0).then_some(memory),
        memory_swap: match data.swap {
            0 => None,
            -1 => Some(-1),
            swap => Some(memory + (swap * 1024 * 1024)),
        },
        blkio_weight: data.io_weight.and_then(|weight| u16::try_from(weight).ok()),
        pids_limit: match config.docker.container_pid_limit {
            0 => None,
            limit => Some(limit),
        },
        cpu_quota: Some(if data.cpu > 0 { data.cpu * 1000 } else { -1 }),
        cpu_period: (data.cpu > 0).then_some(100_000),
        cpu_shares: (data.cpu > 0).then_some(1024),
        ..Default::default()
    }
}

fn socket_mount_target(socket_path: &str) -> String {
    socket_path
        .split('/')
        .rev()
        .skip(1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .join("/")
}

fn host_config(data: &StoredInstance, config: &AgentConfig) -> HostConfig {
    let limits = resources(data, config);

    let mut mounts = vec![Mount {
        typ: Some(MountType::BIND),
        source: Some(config.socket_dir(data.uuid).to_string_lossy().into_owned()),
        target: Some(socket_mount_target(&data.socket_path)),
        ..Default::default()
    }];

    let data_dir = config.data_dir(data.uuid);
    for mapping in data.volumes.entries() {
        mounts.push(Mount {
            typ: Some(MountType::BIND),
            source: Some(mapping.host_path(&data_dir).to_string_lossy().into_owned()),
            target: Some(mapping.container_path().to_string_lossy().into_owned()),
            ..Default::default()
        });
    }

    HostConfig {
        memory: limits.memory,
        memory_reservation: limits.memory_reservation,
        memory_swap: limits.memory_swap,
        cpu_quota: limits.cpu_quota,
        cpu_period: limits.cpu_period,
        cpu_shares: limits.cpu_shares,
        blkio_weight: limits.blkio_weight,
        pids_limit: limits.pids_limit,

        mounts: Some(mounts),
        tmpfs: Some(HashMap::from([(
            "/tmp".to_owned(),
            format!("rw,exec,nosuid,size={}M", config.docker.tmpfs_size),
        )])),
        log_config: Some(HostConfigLogConfig {
            typ: Some(config.docker.log_driver.clone()),
            config: Some(config.docker.log_options.clone().into_iter().collect()),
        }),
        network_mode: Some("none".to_owned()),
        userns_mode: if config.docker.rootless {
            Some(format!(
                "keep-id:uid={},gid={}",
                data.image_uid, data.image_gid
            ))
        } else {
            config.docker.userns_mode.clone()
        },
        ..Default::default()
    }
}

fn container_config(data: &StoredInstance, config: &AgentConfig) -> ContainerCreateBody {
    let mut env = Vec::new();
    if let Some(timezone) = data.timezone.as_ref().or(config.docker.timezone.as_ref()) {
        env.push(format!("TZ={timezone}"));
    }
    env.extend(
        data.env
            .iter()
            .map(|(key, value)| format!("{key}={value}")),
    );

    ContainerCreateBody {
        hostname: Some(data.uuid.to_string()),
        image: Some(data.image.clone()),
        env: Some(env),
        cmd: data.cmd.clone(),
        labels: Some(HashMap::from([
            ("Service".to_owned(), SERVICE_LABEL.to_owned()),
            ("ContainerType".to_owned(), "database".to_owned()),
        ])),
        host_config: Some(host_config(data, config)),
        attach_stdin: Some(true),
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        open_stdin: Some(true),
        tty: Some(true),
        ..Default::default()
    }
}

async fn image_exists(docker: &Docker, image: &str) -> bool {
    docker
        .list_images(Some(ListImagesOptions {
            all: true,
            filters: Some(HashMap::from([(
                "reference".to_owned(),
                vec![image.to_owned()],
            )])),
            ..Default::default()
        }))
        .await
        .is_ok_and(|images| !images.is_empty())
}

fn split_image(image: &str) -> (&str, &str) {
    match image.rsplit_once(':') {
        Some((name, tag))
            if !tag.is_empty() && image.rfind('/').is_none_or(|slash| slash < name.len()) =>
        {
            (name, tag)
        }
        _ => (image, "latest"),
    }
}

async fn pull_image(docker: &Docker, config: &AgentConfig, image: &str) -> anyhow::Result<()> {
    let (name, tag) = split_image(image);

    let credentials = config
        .docker
        .registries
        .iter()
        .find(|(registry, _)| image.starts_with(registry.as_str()))
        .map(|(registry, registry_config)| DockerCredentials {
            username: Some(registry_config.username.clone()),
            password: Some(registry_config.password.clone()),
            serveraddress: Some(registry.clone()),
            ..Default::default()
        });

    let mut stream = docker.create_image(
        Some(CreateImageOptions {
            from_image: Some(name.to_owned()),
            tag: Some(tag.to_owned()),
            ..Default::default()
        }),
        None,
        credentials,
    );

    while let Some(status) = stream.next().await {
        if let Err(err) = status {
            tracing::error!(image = %name, "failed to pull image: {err:?}");

            if !image_exists(docker, name).await {
                return Err(err.into());
            }

            tracing::warn!(image = %name, "image exists locally, ignoring the pull error");
        }
    }

    Ok(())
}

async fn find_container(docker: &Docker, name: &str) -> Option<String> {
    docker
        .list_containers(Some(ListContainersOptions {
            all: true,
            filters: Some(HashMap::from([(
                "name".to_owned(),
                vec![name.to_owned()],
            )])),
            ..Default::default()
        }))
        .await
        .unwrap_or_default()
        .into_iter()
        .find_map(|container| container.id)
}

pub struct DockerHandle {
    container_id: String,
    docker: Docker,
    config: Arc<AgentConfig>,
    usage: Arc<RwLock<ResourceUsage>>,
    usage_task: JoinHandle<()>,
    lifecycle_task: JoinHandle<()>,
}

impl Drop for DockerHandle {
    fn drop(&mut self) {
        self.usage_task.abort();
        self.lifecycle_task.abort();
    }
}

impl DockerHandle {
    fn new(
        container_id: String,
        docker: Docker,
        config: Arc<AgentConfig>,
        instance: Uuid,
    ) -> Self {
        let usage = Arc::new(RwLock::new(ResourceUsage::default()));

        let usage_task = tokio::spawn(Self::stats_loop(
            docker.clone(),
            container_id.clone(),
            Arc::clone(&usage),
            instance,
        ));
        let lifecycle_task = tokio::spawn(Self::state_loop(
            docker.clone(),
            container_id.clone(),
            Arc::clone(&usage),
            instance,
        ));

        Self {
            container_id,
            docker,
            config,
            usage,
            usage_task,
            lifecycle_task,
        }
    }

    pub async fn create(
        docker: &Docker,
        config: &Arc<AgentConfig>,
        data: &StoredInstance,
    ) -> anyhow::Result<Self> {
        pull_image(docker, config, &data.image).await?;

        let data_dir = config.data_dir(data.uuid);
        tokio::fs::create_dir_all(data_dir.join("volumes")).await?;
        for mapping in data.volumes.entries() {
            let host_path = mapping.host_path(&data_dir);
            tokio::fs::create_dir_all(&host_path).await?;
            if !config.docker.rootless {
                std::os::unix::fs::chown(&host_path, Some(data.image_uid), Some(data.image_gid))?;
            }
        }

        let socket_dir = config.socket_dir(data.uuid);
        tokio::fs::create_dir_all(&socket_dir).await?;
        if !config.docker.rootless {
            std::os::unix::fs::chown(&socket_dir, Some(data.image_uid), Some(data.image_gid))?;
        }

        let container = docker
            .create_container(
                Some(CreateContainerOptions {
                    name: Some(data.uuid.to_string()),
                    ..Default::default()
                }),
                container_config(data, config),
            )
            .await?;

        Ok(Self::new(
            container.id,
            docker.clone(),
            Arc::clone(config),
            data.uuid,
        ))
    }

    pub async fn attach(
        docker: &Docker,
        config: &Arc<AgentConfig>,
        instance: Uuid,
    ) -> Option<Self> {
        let container_id = find_container(docker, &instance.to_string()).await?;

        Some(Self::new(
            container_id,
            docker.clone(),
            Arc::clone(config),
            instance,
        ))
    }

    pub async fn destroy(docker: &Docker, instance: Uuid) -> anyhow::Result<()> {
        let containers = docker
            .list_containers(Some(ListContainersOptions {
                all: true,
                filters: Some(HashMap::from([(
                    "name".to_owned(),
                    vec![instance.to_string()],
                )])),
                ..Default::default()
            }))
            .await?;

        for container in containers {
            let Some(id) = container.id else { continue };
            if let Err(err) = docker
                .remove_container(
                    &id,
                    Some(RemoveContainerOptions {
                        force: true,
                        ..Default::default()
                    }),
                )
                .await
            {
                tracing::error!(instance = %instance, container = %id, "failed to remove container: {err}");
            }
        }

        Ok(())
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "the cpu percentage does not need full integer precision"
    )]
    async fn stats_loop(
        docker: Docker,
        container_id: String,
        usage: Arc<RwLock<ResourceUsage>>,
        instance: Uuid,
    ) {
        let mut previous_cpu = 0;
        let mut previous_instant: Option<Instant> = None;

        loop {
            let mut stream = docker.stats(
                &container_id,
                Some(StatsOptions {
                    stream: false,
                    one_shot: true,
                }),
            );

            let (stats, ()) =
                tokio::join!(stream.next(), tokio::time::sleep(Duration::from_secs(1)));
            drop(stream);

            let Some(stats) = stats else { break };
            let stats = match stats {
                Ok(stats) => stats,
                Err(err) => {
                    tracing::warn!(instance = %instance, "failed to read container stats: {err:?}");
                    continue;
                }
            };

            let mut usage = usage.write();

            if let Some(memory_stats) = stats.memory_stats.as_ref() {
                let mut memory_bytes = memory_stats.usage.unwrap_or_default();

                if let Some(detail) = memory_stats.stats.as_ref() {
                    let inactive = detail
                        .get("total_inactive_file")
                        .or_else(|| detail.get("inactive_file"))
                        .copied()
                        .unwrap_or_default();
                    if inactive < memory_bytes {
                        memory_bytes -= inactive;
                    }
                }

                usage.memory_bytes = memory_bytes;
                usage.memory_limit_bytes = memory_stats.limit.unwrap_or_default();
            }

            if let Some(cpu_usage) = stats
                .cpu_stats
                .as_ref()
                .and_then(|cpu| cpu.cpu_usage.as_ref())
            {
                let total = cpu_usage.total_usage.unwrap_or_default();
                let now = Instant::now();

                usage.cpu_absolute = previous_instant.map_or(0.0f64, |previous| {
                    let cpu_delta = total.saturating_sub(previous_cpu) as f64;
                    let wall_delta = now.duration_since(previous).as_nanos() as f64;

                    if wall_delta > 0.0f64 && cpu_delta > 0.0f64 {
                        ((cpu_delta / wall_delta) * 100.0f64 * 1000.0f64).round() / 1000.0f64
                    } else {
                        0.0f64
                    }
                });

                previous_cpu = total;
                previous_instant = Some(now);
            }

            drop(usage);
        }
    }

    #[expect(clippy::infinite_loop, reason = "the task runs until it is aborted")]
    async fn state_loop(
        docker: Docker,
        container_id: String,
        usage: Arc<RwLock<ResourceUsage>>,
        instance: Uuid,
    ) {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let inspect = match docker.inspect_container(&container_id, None).await {
                Ok(inspect) => inspect,
                Err(DockerResponseServerError {
                    status_code: 404, ..
                }) => ContainerInspectResponse::default(),
                Err(err) => {
                    tracing::warn!(instance = %instance, "failed to inspect container: {err:?}");
                    continue;
                }
            };
            let state = inspect.state.unwrap_or_default();

            let (container_state, uptime) = match state.status {
                Some(ContainerStateStatusEnum::RUNNING) => {
                    let uptime = state
                        .started_at
                        .as_deref()
                        .and_then(|started| chrono::DateTime::parse_from_rfc3339(started).ok())
                        .map_or(0, |started| {
                            chrono::Utc::now()
                                .signed_duration_since(started.with_timezone(&chrono::Utc))
                                .num_milliseconds()
                                .max(0)
                                .cast_unsigned()
                        });
                    (ContainerState::Running, uptime)
                }
                Some(ContainerStateStatusEnum::PAUSED) => (ContainerState::Stopping, 0),
                _ => (ContainerState::Offline, 0),
            };

            let mut usage = usage.write();
            usage.state = container_state;
            usage.uptime = uptime;
            drop(usage);
        }
    }

    pub fn resource_usage(&self, disk_bytes: &core::sync::atomic::AtomicU64) -> ResourceUsage {
        let mut usage = *self.usage.read();
        usage.disk_bytes = disk_bytes.load(Ordering::Relaxed);
        usage
    }

    pub fn state(&self) -> ContainerState {
        self.usage.read().state
    }

    pub async fn start(&self) -> anyhow::Result<()> {
        self.usage.write().state = ContainerState::Starting;
        self.docker
            .start_container(&self.container_id, None::<StartContainerOptions>)
            .await?;
        Ok(())
    }

    pub async fn stop(&self) -> anyhow::Result<()> {
        self.usage.write().state = ContainerState::Stopping;
        self.docker
            .stop_container(
                &self.container_id,
                Some(StopContainerOptions {
                    t: Some(STOP_TIMEOUT),
                    ..Default::default()
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn kill(&self) -> anyhow::Result<()> {
        self.docker
            .kill_container(
                &self.container_id,
                Some(KillContainerOptions {
                    signal: "SIGKILL".to_owned(),
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn update_resources(&self, data: &StoredInstance) -> anyhow::Result<()> {
        let limits = resources(data, &self.config);

        self.docker
            .update_container(
                &self.container_id,
                ContainerUpdateBody {
                    memory: limits.memory,
                    memory_reservation: limits.memory_reservation,
                    memory_swap: limits.memory_swap,
                    cpu_quota: limits.cpu_quota,
                    cpu_period: limits.cpu_period,
                    cpu_shares: limits.cpu_shares,
                    blkio_weight: limits.blkio_weight,
                    pids_limit: limits.pids_limit,
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    pub fn logs(&self, lines: Option<usize>) -> BoxStream<'static, anyhow::Result<Bytes>> {
        self.docker
            .logs(
                &self.container_id,
                Some(LogsOptions {
                    follow: false,
                    stdout: true,
                    stderr: true,
                    timestamps: false,
                    tail: lines.map_or_else(|| "all".to_owned(), |count| count.to_string()),
                    ..Default::default()
                }),
            )
            .map(|result| {
                result
                    .map(bollard::container::LogOutput::into_bytes)
                    .map_err(anyhow::Error::from)
            })
            .boxed()
    }

    pub async fn exec(&self, options: ExecOptions) -> anyhow::Result<ExecStream> {
        let exec = self
            .docker
            .create_exec(
                &self.container_id,
                CreateExecOptions {
                    attach_stdin: Some(true),
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    tty: Some(false),
                    cmd: Some(options.command),
                    ..Default::default()
                },
            )
            .await?;

        match self
            .docker
            .start_exec(
                &exec.id,
                Some(StartExecOptions {
                    detach: false,
                    tty: false,
                    ..Default::default()
                }),
            )
            .await?
        {
            StartExecResults::Attached { output, input } => {
                let docker = self.docker.clone();
                let exec_id = exec.id;

                Ok(ExecStream {
                    output: output
                        .map(|result| {
                            result
                                .map(bollard::container::LogOutput::into_bytes)
                                .map_err(anyhow::Error::from)
                        })
                        .chain(futures_util::stream::once(async move {
                            match docker.inspect_exec(&exec_id).await?.exit_code {
                                Some(code) if code != 0 => {
                                    Err(anyhow::anyhow!("the command exited with code {code}"))
                                }
                                _ => Ok(Bytes::new()),
                            }
                        }))
                        .boxed(),
                    stdin: input,
                })
            }
            StartExecResults::Detached => {
                Err(anyhow::anyhow!("the exec session detached unexpectedly"))
            }
        }
    }
}
