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
# directory falls back to /, which is read-only. An id of the base image that collides is
# dropped, so that ours is the entry that resolves.
ARG CONTAINER_UID=25335
ARG CONTAINER_GID=25335
RUN sed -i "/^[^:]*:[^:]*:${CONTAINER_UID}:/d" /etc/passwd \
    && sed -i "/^[^:]*:[^:]*:${CONTAINER_GID}:/d" /etc/group \
    && echo "container:x:${CONTAINER_UID}:${CONTAINER_GID}::/work:/bin/sh" >> /etc/passwd \
    && echo "container:x:${CONTAINER_GID}:" >> /etc/group

WORKDIR /work
ENTRYPOINT ["/bin/sh", "-c", "eval \"exec $STARTUP_COMMAND\""]
HEALTHCHECK --start-period=2m --retries=3 --interval=30s CMD /mc-monitor status -json -port "${NOVIUM_PORT_MINECRAFT:-25577}"
