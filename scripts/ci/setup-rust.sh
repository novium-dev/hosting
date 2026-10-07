#!/bin/sh
set -eu

apk add --no-cache openssh-client-default musl-dev ncurses-dev ncurses-static \
    zlib-dev zlib-static zstd-dev zstd-static llvm22-static llvm22-dev clang22 clang22-static \
    lld22 postgresql18-client sqlite curl \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

eval "$(ssh-agent -s)"
printf '%s\n' "$DAEMON_SSH_KEY" | tr -d '\r' | ssh-add -
echo "SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$GITHUB_ENV"
echo "SSH_AGENT_PID=$SSH_AGENT_PID" >> "$GITHUB_ENV"
