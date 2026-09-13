FROM itzg/mc-monitor:0.15.0 as monitor

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        adduser \
        ca-certificates \
        curl \
        jq \
        wget \
    && rm -rf /var/lib/apt/lists/*

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

WORKDIR /work
ENTRYPOINT ["/bin/sh", "-c", "eval \"exec $STARTUP_COMMAND\""]
HEALTHCHECK --start-period=2m --retries=3 --interval=30s CMD /mc-monitor status -json -port "${NOVIUM_PORT_MINECRAFT:-25577}"
