FROM itzg/mc-monitor:0.15.0 as monitor

FROM alpine:latest

RUN apk update
RUN apk add --no-cache wget curl jq ca-certificates
RUN update-ca-certificates

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

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
    getent group "${CONTAINER_GID}" >/dev/null || addgroup -g "${CONTAINER_GID}" container; \
    adduser -D -H -u "${CONTAINER_UID}" -G "$(getent group "${CONTAINER_GID}" | cut -d: -f1)" -h /work -s /bin/sh container

WORKDIR /work
ENTRYPOINT ["/bin/sh", "-c", "eval \"exec $STARTUP_COMMAND\""]
HEALTHCHECK --start-period=2m --retries=3 --interval=30s CMD /mc-monitor status -json -port "${NOVIUM_PORT_MINECRAFT:-25577}"
