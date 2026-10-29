FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        libatomic1 \
        tini \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

ARG VERSION={DEFAULT_VERSION}
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
        amd64) teamspeak_arch=amd64 ;; \
        arm64) teamspeak_arch=arm64 ;; \
        *) echo "Unsupported architecture for TeamSpeak 6: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    mkdir -p /opt/teamspeak; \
    curl -fsSL "https://github.com/teamspeak/teamspeak6-server/releases/download/${VERSION}/teamspeak6-server-linux-${teamspeak_arch}.tar.xz" \
        | tar -xJ -C /opt/teamspeak; \
    chmod -R a+rX /opt/teamspeak

ENV HOME=/work \
    TEAMSPEAK_GENERATION=6

RUN rm -rf /tmp /var/tmp && \
    ln -s /work/.tmp /tmp && \
    ln -s /work/.tmp /var/tmp

{ENTRYPOINT_SCRIPT}

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
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/teamspeak-entrypoint"]
