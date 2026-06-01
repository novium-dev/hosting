ARG SATISFACTORY_PLATFORM=linux/amd64
FROM --platform=$SATISFACTORY_PLATFORM debian:bookworm-slim

RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        lib32gcc-s1 \
        libgcc-s1 \
        libgcc-s1:i386 \
        libstdc++6 \
        libstdc++6:i386 \
        tini \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/steamcmd \
    && curl -sSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
        | tar -xz -C /opt/steamcmd

RUN set -eux; \
    { \
        echo '#!/bin/bash'; \
        echo 'set -euo pipefail'; \
        echo 'cd /work'; \
        echo 'export HOME=/work'; \
        echo 'mkdir -p .steam/sdk32 .steam/sdk64 FactoryGame/Saved/Config/LinuxServer'; \
        echo 'binary=(./Engine/Binaries/Linux/*-Linux-Shipping)'; \
        echo 'if [[ "${AUTO_UPDATE:-1}" == "1" || ! -e "${binary[0]}" ]]; then'; \
        echo '  steamcmd=(/opt/steamcmd/steamcmd.sh +force_install_dir /work +login anonymous +app_update "${SRCDS_APPID:-1690800}")'; \
        echo '  if [[ -n "${SRCDS_BETAID:-}" ]]; then'; \
        echo '    steamcmd+=(-beta "$SRCDS_BETAID")'; \
        echo '  fi'; \
        echo '  if [[ -n "${SRCDS_BETAPASS:-}" ]]; then'; \
        echo '    steamcmd+=(-betapassword "$SRCDS_BETAPASS")'; \
        echo '  fi'; \
        echo '  if [[ "${VALIDATE:-0}" == "1" || "${VALIDATE:-}" == "true" ]]; then'; \
        echo '    steamcmd+=(validate)'; \
        echo '  fi'; \
        echo '  steamcmd+=(+quit)'; \
        echo '  "${steamcmd[@]}"'; \
        echo 'fi'; \
        echo 'cp -f /opt/steamcmd/linux32/steamclient.so .steam/sdk32/steamclient.so'; \
        echo 'cp -f /opt/steamcmd/linux64/steamclient.so .steam/sdk64/steamclient.so'; \
        echo 'binary=(./Engine/Binaries/Linux/*-Linux-Shipping)'; \
        echo 'chmod +x "${binary[@]}"'; \
        echo 'exec "${binary[0]}" FactoryGame -Port=7777 -ReliablePort=8888'; \
    } > /usr/local/bin/satisfactory-entrypoint \
    && chmod +x /usr/local/bin/satisfactory-entrypoint

WORKDIR /work
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/satisfactory-entrypoint"]
