# syntax=docker/dockerfile:1
# ============================================
# Backend build
# ============================================
FROM lukemathwalker/cargo-chef:latest-rust-1.99.0-alpine AS chef
WORKDIR /work

ARG FLAGS="-C debuginfo=0 -C codegen-units=40 -C opt-level=3"
ENV RUSTFLAGS="-C linker=clang-22 -C link-arg=-fuse-ld=lld $FLAGS"
ENV CARGO_PROFILE_RELEASE_LTO=off

FROM chef AS utils

RUN RUSTFLAGS="-C opt-level=0 -C codegen-units=40" cargo install sqlx-cli --no-default-features --features postgres,rustls --locked

FROM chef AS dependencies

RUN apk add --no-cache git curl musl-dev clang22 lld22 zlib-dev zlib-static zstd-dev zstd-static postgresql18 postgresql18-client --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM dependencies AS builder

COPY --from=planner /work/recipe.json recipe.json

ARG FEATURES="default"

RUN cargo chef cook --bin backend --release --recipe-path recipe.json --no-default-features --features "$FEATURES" --target x86_64-unknown-linux-musl

COPY --from=utils /usr/local/cargo/bin/cargo-sqlx /usr/local/cargo/bin/cargo-sqlx
COPY . .

RUN FEATURES="$FEATURES" ./scripts/docker/build_backend.sh

FROM scratch AS runtime

STOPSIGNAL SIGINT

EXPOSE 8080

COPY --from=builder /work/target/x86_64-unknown-linux-musl/release/backend /backend
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENTRYPOINT ["/backend"]
