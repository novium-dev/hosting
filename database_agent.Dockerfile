# syntax=docker/dockerfile:1
# ============================================
# Database agent build
# ============================================
FROM lukemathwalker/cargo-chef:latest-rust-1.99.0-alpine AS chef
WORKDIR /work

ARG FLAGS="-C debuginfo=0 -C codegen-units=1 -C opt-level=3 -C link-arg=-Wl,--icf=safe"
ENV RUSTFLAGS="-C linker=clang-22 -C link-arg=-fuse-ld=lld $FLAGS"
ENV CARGO_PROFILE_RELEASE_LTO=thin

FROM chef AS dependencies

RUN apk add --no-cache ncurses-dev ncurses-static zlib-dev zlib-static zstd-dev zstd-static llvm22-static llvm22-dev git sqlite musl-dev llvm22 clang22 clang22-static lld22 curl --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM dependencies AS builder

RUN echo '#!/bin/ash' > /llvm-config-static.sh && echo 'if [[ "$1" == "--libs" ]]; then echo "$(/usr/bin/llvm-config-22 "$@" "--link-static")" "-lzstd"; else /usr/bin/llvm-config-22 "$@"; fi' >> /llvm-config-static.sh && chmod +x /llvm-config-static.sh
ENV LLVM_CONFIG_PATH="/llvm-config-static.sh"

COPY --from=planner /work/recipe.json recipe.json

RUN cargo chef cook --bin database_agent --release --recipe-path recipe.json --target x86_64-unknown-linux-musl

COPY . .

RUN ./scripts/docker/build_database_agent.sh

FROM scratch AS runtime

STOPSIGNAL SIGINT

# The API the backend talks to. The proxy listeners (5432/3306/27017/6379 by
# default) come from the config file and are not declared here.
EXPOSE 8090

# Reads config.toml, agent_root.pem and agent.pem from this directory; mount the
# docker socket, the socket directory and the data directory the config points
# at. When config.toml is missing the agent runs its setup instead, which needs
# SETUP_URL and SETUP_TOKEN and writes all three files here.
ENV DATABASE_AGENT_DATA_DIR=/data

COPY --from=builder /work/target/x86_64-unknown-linux-musl/release/database_agent /database_agent
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENTRYPOINT ["/database_agent"]
