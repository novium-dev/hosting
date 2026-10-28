FROM {BASE_IMAGE}

ARG WEB_SERVER
ENV WEB_SERVER=${WEB_SERVER}

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        git \
        media-types \
        tini \
        unzip \
        "${WEB_SERVER}" \
    && rm -rf /var/lib/apt/lists/*

# PHP images only: the common extensions most PHP applications expect, composer, and the
# production php.ini. Without php-fpm the image only serves static files.
RUN set -eu; \
    if command -v php-fpm > /dev/null; then \
        curl -fsSL -o /usr/local/bin/install-php-extensions https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions; \
        chmod +x /usr/local/bin/install-php-extensions; \
        install-php-extensions bcmath exif gd intl mysqli opcache pcntl pdo_mysql pdo_pgsql pgsql redis zip; \
        curl -fsSL https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer; \
        cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"; \
    fi

# Files in /work/php are loaded after the bundled configuration, so users can override
# any php.ini setting there.
ENV PHP_INI_SCAN_DIR=":/work/php" \
    COMPOSER_HOME=/work/.composer \
    HOME=/work

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
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/web-entrypoint"]
