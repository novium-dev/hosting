# ============================================
# Database agent build
# ============================================
FROM lukemathwalker/cargo-chef:latest-rust-1.95.0-alpine AS chef
WORKDIR /work

ARG FLAGS="-C debuginfo=0 -C codegen-units=1 -C opt-level=3 -C link-arg=-Wl,--icf=safe"
ENV RUSTFLAGS="-C linker=clang -C link-arg=-fuse-ld=lld $FLAGS"

FROM chef AS dependencies

RUN apk add --no-cache git ca-certificates sqlite musl-dev llvm21 clang21 lld21 curl --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main
RUN ln -sf /usr/bin/clang-21 /usr/local/bin/clang \
    && ln -sf /usr/bin/ld.lld-21 /usr/local/bin/ld.lld

RUN apk upgrade --no-cache gcc --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM dependencies AS builder

COPY --from=planner /work/recipe.json recipe.json

RUN --mount=type=ssh cargo chef cook --release --recipe-path recipe.json --target x86_64-unknown-linux-musl

COPY . .

RUN --mount=type=ssh ./scripts/docker/build_database_agent.sh

FROM scratch AS runtime

STOPSIGNAL SIGINT

# The API the backend talks to. The proxy listeners (5432/3306/27017/6379 by
# default) come from the config file and are not declared here.
EXPOSE 8090

# Reads config.toml from this directory; mount the docker socket, the socket
# directory and the data directory the config points at.
ENV DATABASE_AGENT_DATA_DIR=/data

COPY --from=builder /work/target/x86_64-unknown-linux-musl/release/database_agent /database_agent
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENTRYPOINT ["/database_agent"]
