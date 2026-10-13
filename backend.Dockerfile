# syntax=docker/dockerfile:1
# ============================================
# Backend build
# ============================================
FROM lukemathwalker/cargo-chef:latest-rust-1.99.0-alpine AS chef
WORKDIR /work

ARG FLAGS="-C debuginfo=0 -C codegen-units=40 -C opt-level=3 -C lto=off"
ENV RUSTFLAGS="-C linker=clang-22 -C link-arg=-fuse-ld=mold $FLAGS"

FROM chef AS utils

RUN RUSTFLAGS="-C opt-level=0 -C codegen-units=40" cargo install sqlx-cli --no-default-features --features postgres,rustls --locked

FROM chef AS dependencies

RUN apk add --no-cache ncurses-dev ncurses-static zlib-dev zlib-static zstd-dev zstd-static llvm22-static llvm22-dev git postgresql18 postgresql18-client musl-dev llvm22 clang22 clang22-static mold curl --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM dependencies AS builder

RUN echo '#!/bin/ash' > /llvm-config-static.sh && echo 'if [[ "$1" == "--libs" ]]; then echo "$(/usr/bin/llvm-config-22 "$@" "--link-static")" "-lzstd"; else /usr/bin/llvm-config-22 "$@"; fi' >> /llvm-config-static.sh && chmod +x /llvm-config-static.sh
ENV LLVM_CONFIG_PATH="/llvm-config-static.sh"

COPY --from=planner /work/recipe.json recipe.json

ARG FEATURES="default"

RUN cargo chef cook --bin backend --release --recipe-path recipe.json --no-default-features --features "$FEATURES" --target x86_64-unknown-linux-musl

COPY --from=utils /usr/local/cargo/bin/cargo-sqlx /usr/local/cargo/bin/cargo-sqlx
COPY . .

# build
RUN FEATURES="$FEATURES" ./scripts/docker/build_backend.sh

FROM scratch AS runtime

STOPSIGNAL SIGINT

EXPOSE 8080

COPY --from=builder /work/target/x86_64-unknown-linux-musl/release/backend /backend
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENTRYPOINT ["/backend"]
