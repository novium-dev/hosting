# ============================================
# Frontend build (client-only Vite SPA)
# ============================================
FROM oven/bun:1 AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --no-save --frozen-lockfile
COPY frontend/ ./
RUN bun run build

# ============================================
# Backend build
# ============================================
FROM lukemathwalker/cargo-chef:latest-rust-1.98.0-alpine AS chef
WORKDIR /work

ARG FLAGS="-C debuginfo=0 -C codegen-units=1 -C opt-level=3 -C link-arg=-Wl,--icf=safe -C linker-plugin-lto -C lto=thin -C embed-bitcode"
ENV RUSTFLAGS="-C linker=clang-22 -C link-arg=-fuse-ld=lld $FLAGS"

FROM chef AS utils

RUN RUSTFLAGS="-C opt-level=0" cargo install sqlx-cli --no-default-features --features postgres,rustls --locked

FROM chef AS dependencies

RUN apk add --no-cache ncurses-dev ncurses-static zlib-dev zlib-static zstd-dev zstd-static llvm22-static llvm22-dev git postgresql18 postgresql18-client musl-dev llvm22 clang22 clang22-static lld22 curl --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM dependencies AS builder

RUN echo '#!/bin/ash' > /llvm-config-static.sh && echo 'if [[ "$1" == "--libs" ]]; then echo "$(/usr/bin/llvm-config-22 "$@" "--link-static")" "-lzstd"; else /usr/bin/llvm-config-22 "$@"; fi' >> /llvm-config-static.sh && chmod +x /llvm-config-static.sh
ENV LLVM_CONFIG_PATH="/llvm-config-static.sh"

COPY --from=planner /work/recipe.json recipe.json

ARG FEATURES="default"

RUN --mount=type=ssh cargo chef cook --release --recipe-path recipe.json --no-default-features --features "$FEATURES" --target x86_64-unknown-linux-musl

COPY --from=utils /usr/local/cargo/bin/cargo-sqlx /usr/local/cargo/bin/cargo-sqlx
COPY . .

# build
RUN FEATURES="$FEATURES" ./scripts/docker/build_backend.sh

FROM scratch AS runtime

STOPSIGNAL SIGINT

EXPOSE 80

# The backend serves the client-only SPA from this directory (see backend/src/http.rs).
ENV BACKEND_FRONTEND_DIR=/frontend

# Copy the binary directly to bin directory (/bin)
COPY --from=builder /work/target/x86_64-unknown-linux-musl/release/backend /backend
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# Built SPA served same-origin by the backend.
COPY --from=frontend /app/frontend/dist /frontend

ENTRYPOINT ["/backend"]
