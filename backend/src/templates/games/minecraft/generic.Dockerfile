FROM itzg/mc-monitor:0.15.0 as monitor

FROM debian:bookworm-slim as rcon-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        libglib2.0-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch 0.6 https://github.com/n0la/rcon.git /usr/src/rcon \
    && cmake -S /usr/src/rcon -B /usr/src/rcon/build -DCMAKE_BUILD_TYPE=Release -DINSTALL_BASH_COMPLETION=OFF \
    && cmake --build /usr/src/rcon/build --target rcon -j"$(nproc)"

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        jq \
        libglib2.0-0 \
        libstdc++6 \
        libudev1 \
        wget \
    && rm -rf /var/lib/apt/lists/*

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

COPY --from=monitor /mc-monitor /mc-monitor
COPY --from=rcon-builder /usr/src/rcon/build/rcon /usr/local/bin/rcon

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
HEALTHCHECK --start-period=2m --retries=3 --interval=30s CMD /mc-monitor status -json
