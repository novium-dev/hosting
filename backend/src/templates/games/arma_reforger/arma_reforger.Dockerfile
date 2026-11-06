ARG ARMA_REFORGER_PLATFORM=linux/amd64
FROM --platform=$ARMA_REFORGER_PLATFORM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        jq \
        lib32gcc-s1 \
        libcurl4 \
        libssl3 \
        python3 \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Pristine SteamCMD. The container rootfs is read-only at runtime and SteamCMD
# writes into its own directory, so this is only a template that gets copied
# into /work on first start.
RUN mkdir -p /opt/steamcmd \
    && curl -sSL https://media.steampowered.com/client/installer/steamcmd_linux.tar.gz \
        | tar -xz -C /opt/steamcmd \
    && chmod -R a+rX /opt/steamcmd \
    && chmod a+x /opt/steamcmd/steamcmd.sh /opt/steamcmd/linux32/steamcmd

# /work is the only writable path, so HOME and TMPDIR have to live there.
# .tmp/ is excluded from backups by the daemon.
ENV HOME=/work \
    TMPDIR=/work/.tmp

# Steam's crash handler insists on creating /tmp/dumps and aborts if it cannot,
# which a read-only rootfs guarantees. The daemon creates the target on every start.
RUN rm -rf /tmp && ln -s /work/.tmp /tmp

{ENTRYPOINT_SCRIPT}

{A2S_SCRIPT}

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

WORKDIR /work
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/arma-reforger-entrypoint"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15m --retries=5 \
    CMD /usr/local/bin/steam-a2s "${NOVIUM_PORT_A2S:-17777}"
