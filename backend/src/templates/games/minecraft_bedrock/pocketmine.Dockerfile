ARG BEDROCK_PLATFORM=linux/amd64
FROM --platform=$BEDROCK_PLATFORM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        jq \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Every release names the PHP version it was built against. The prebuilt PHP binary
# points its extension_dir at the CI build path, so it is redirected to the bundled one.
ARG VERSION={DEFAULT_VERSION}
RUN set -eu; \
    mkdir -p /opt/pocketmine; \
    cd /opt/pocketmine; \
    release="https://github.com/pmmp/PocketMine-MP/releases/download/${VERSION}"; \
    curl -fsSL -o PocketMine-MP.phar "${release}/PocketMine-MP.phar"; \
    php_version="$(curl -fsSL "${release}/build_info.json" | jq -r .php_version)"; \
    curl -fsSL "https://github.com/pmmp/PHP-Binaries/releases/download/pm5-php-${php_version}-latest/PHP-${php_version}-Linux-x86_64-PM5.tar.gz" | tar -xz; \
    extension_dir="$(find /opt/pocketmine/bin/php7/lib/php/extensions -mindepth 1 -maxdepth 1 -type d | head -n 1)"; \
    echo "extension_dir=\"${extension_dir}\"" >> bin/php7/bin/php.ini; \
    chmod -R a+rX /opt/pocketmine

ENV HOME=/work

RUN rm -rf /tmp /var/tmp && \
    ln -s /work/.tmp /tmp && \
    ln -s /work/.tmp /var/tmp

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
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/pocketmine/bin/php7/bin/php", "/opt/pocketmine/PocketMine-MP.phar", "--no-wizard", "--data=/work/", "--plugins=/work/plugins/"]
