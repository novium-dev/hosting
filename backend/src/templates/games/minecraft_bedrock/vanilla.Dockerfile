ARG BEDROCK_PLATFORM=linux/amd64
FROM --platform=$BEDROCK_PLATFORM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        libcurl4 \
        tini \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# The download is refused without a browser user agent.
ARG VERSION
RUN set -eu; \
    mkdir -p /opt/bedrock; \
    curl -fsSL --http1.1 -A "Mozilla/5.0 (X11; Linux x86_64)" -o /opt/bedrock.zip \
        "https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${VERSION}.zip"; \
    unzip -q /opt/bedrock.zip -d /opt/bedrock; \
    rm /opt/bedrock.zip; \
    chmod -R a+rX /opt/bedrock; \
    chmod a+x /opt/bedrock/bedrock_server

ENV HOME=/work

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
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/bedrock-entrypoint"]
