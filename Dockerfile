FROM lukemathwalker/cargo-chef:latest-rust-1.92.0-alpine AS chef
WORKDIR /work

ARG FLAGS="-C debuginfo=0 -C codegen-units=1 -C opt-level=3 -C linker-plugin-lto -C lto=thin -C embed-bitcode -C link-arg=-Wl,--icf=safe"
ENV RUSTFLAGS="-C linker=clang -C link-arg=-fuse-ld=lld $FLAGS"

FROM chef AS utils

RUN RUSTFLAGS="-C opt-level=0" cargo install sqlx-cli --no-default-features --features mysql,rustls --locked

FROM chef AS dependencies

RUN apk add --no-cache git mariadb mariadb-client musl-dev llvm21 clang21 lld21 curl --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main
# zlib-dev zlib-static zstd-dev zstd-static llvm21-static llvm21-dev clang21-static

RUN apk upgrade --no-cache gcc --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

FROM dependencies AS mariadb

RUN mariadb-install-db --user=root --ldata=/var/lib/mysql
RUN echo "USE mysql;FLUSH PRIVILEGES ;GRANT ALL ON *.* TO 'root'@'%' identified by '' WITH GRANT OPTION ;GRANT ALL ON *.* TO 'root'@'localhost' identified by '' WITH GRANT OPTION ;SET PASSWORD FOR 'root'@'localhost'=PASSWORD('') ;DROP DATABASE IF EXISTS test ;FLUSH PRIVILEGES ;" mariadbd --user=root --bootstrap --verbose=0 --skip-name-resolve --skip-networking=0

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM dependencies AS builder

# RUN echo '#!/bin/ash' > /llvm-config-static.sh && echo 'if [[ "$1" == "--libs" ]]; then echo "$(/usr/bin/llvm-config-20 "$@" "--link-static")" "-lzstd"; else /usr/bin/llvm-config-20 "$@"; fi' >> /llvm-config-static.sh && chmod +x /llvm-config-static.sh
# ENV LLVM_CONFIG_PATH="/llvm-config-static.sh"

COPY --from=planner /work/recipe.json recipe.json

ARG FEATURES="default"

RUN --mount=type=ssh cargo chef cook --release --recipe-path recipe.json --no-default-features --features "$FEATURES" --target x86_64-unknown-linux-musl

COPY --from=utils /usr/local/cargo/bin/cargo-sqlx /usr/local/cargo/bin/cargo-sqlx
COPY --from=mariadb /var/lib/mysql /var/lib/mysql
COPY . .

# build
RUN FEATURES="$FEATURES" ./scripts/docker/build_backend.sh

FROM scratch AS runtime

STOPSIGNAL SIGINT

EXPOSE 80

# Copy the binary directly to bin directory (/bin)
COPY --from=builder /work/target/x86_64-unknown-linux-musl/release/backend /backend

ENTRYPOINT ["/backend"]
