FROM itzg/mc-monitor:0.15.0 as monitor

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        fontconfig \
        git \
        iproute2 \
        jq \
        libfreetype6 \
        libstdc++6 \
        libudev1 \
        lsof \
        openssl \
        sqlite3 \
        tar \
        tini \
        tzdata \
        unzip \
        wget \
        zip \
    && rm -rf /var/lib/apt/lists/*

ARG RCON_CLI_VERSION=1.7.7
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) rcon_arch=amd64 ;; \
        arm64) rcon_arch=arm64 ;; \
        armhf) rcon_arch=armv7 ;; \
        armel) rcon_arch=armv6 ;; \
        i386) rcon_arch=386 ;; \
        riscv64) rcon_arch=riscv64 ;; \
        *) echo "Unsupported architecture for rcon-cli: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    wget -qO- "https://github.com/itzg/rcon-cli/releases/download/${RCON_CLI_VERSION}/rcon-cli_${RCON_CLI_VERSION}_linux_${rcon_arch}.tar.gz" \
        | tar -xz -C /usr/local/bin rcon-cli; \
    mv /usr/local/bin/rcon-cli /usr/local/bin/rcon

COPY --from=monitor /mc-monitor /mc-monitor

# The daemon starts the server as this uid and mounts the storage at /work. Without a
# matching entry the uid resolves to no user at all and everything that looks up the home
# directory falls back to /, which is read-only. A base image user holding the uid is
# removed first, a base image group holding the gid is reused.
ARG CONTAINER_UID=25335
ARG CONTAINER_GID=25335
RUN set -eu; \
    existing_user="$(getent passwd "${CONTAINER_UID}" | cut -d: -f1)"; \
    [ -z "${existing_user}" ] || deluser "${existing_user}"; \
    getent group "${CONTAINER_GID}" >/dev/null || addgroup --gid "${CONTAINER_GID}" container; \
    adduser --uid "${CONTAINER_UID}" --gid "${CONTAINER_GID}" --home /work --shell /bin/sh --no-create-home --disabled-password --gecos "" container

ARG MC_MONITOR_DEFAULT_PORT=25565
ENV MC_MONITOR_DEFAULT_PORT=${MC_MONITOR_DEFAULT_PORT}

WORKDIR /work
ENTRYPOINT ["java", "-Dterminal.ansi=true", "-Djava.net.preferIPv6Addresses=system", "-XX:MaxRAMPercentage=95.0", "-jar", "/server.jar"]
HEALTHCHECK --start-period=2m --retries=3 --interval=30s CMD /mc-monitor status -json -port "${NOVIUM_PORT_MINECRAFT:-$MC_MONITOR_DEFAULT_PORT}"
