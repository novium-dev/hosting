FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

ARG VERSION
RUN set -eu; \
    mkdir -p /opt/powernukkitx; \
    curl -fsSL -o /opt/powernukkitx/powernukkitx.jar \
        "https://github.com/PowerNukkitX/PowerNukkitX/releases/download/${VERSION}/powernukkitx.jar"; \
    chmod -R a+rX /opt/powernukkitx

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
ENTRYPOINT ["/usr/bin/tini", "--", "java", "-Dterminal.ansi=true", "-Djava.net.preferIPv6Addresses=system", "-XX:MaxRAMPercentage=95.0", "-jar", "/opt/powernukkitx/powernukkitx.jar"]
