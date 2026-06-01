FROM debian:bookworm-slim

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
        python3-minimal \
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
        echo 'python3 <<'"'"'PY'"'"''; \
        echo 'import configparser'; \
        echo 'import os'; \
        echo ''; \
        echo 'base = "FactoryGame/Saved/Config/LinuxServer"'; \
        echo 'files = {'; \
        echo '    "Game.ini": {'; \
        echo '        "/Script/Engine.GameSession": {'; \
        echo '            "MaxPlayers": os.environ.get("MAX_PLAYERS", "4"),'; \
        echo '        },'; \
        echo '    },'; \
        echo '    "Engine.ini": {'; \
        echo '        "/Script/FactoryGame.FGSaveSession": {'; \
        echo '            "mNumRotatingAutosaves": os.environ.get("NUM_AUTOSAVES", "3"),'; \
        echo '        },'; \
        echo '        "/Script/OnlineSubsystemUtils.IpNetDriver": {'; \
        echo '            "InitialConnectTimeout": os.environ.get("INIT_CONNECT_TIMEOUT", "30"),'; \
        echo '            "ConnectionTimeout": os.environ.get("CONNECT_TIMEOUT", "20"),'; \
        echo '        },'; \
        echo '    },'; \
        echo '}'; \
        echo ''; \
        echo 'for name, sections in files.items():'; \
        echo '    path = os.path.join(base, name)'; \
        echo '    config = configparser.ConfigParser(strict=False)'; \
        echo '    config.optionxform = str'; \
        echo '    config.read(path)'; \
        echo '    for section, values in sections.items():'; \
        echo '        if not config.has_section(section):'; \
        echo '            config.add_section(section)'; \
        echo '        for key, value in values.items():'; \
        echo '            config.set(section, key, value)'; \
        echo '    with open(path, "w", encoding="utf-8") as handle:'; \
        echo '        config.write(handle, space_around_delimiters=False)'; \
        echo 'PY'; \
        echo 'binary=(./Engine/Binaries/Linux/*-Linux-Shipping)'; \
        echo 'chmod +x "${binary[@]}"'; \
        echo 'exec "${binary[0]}" FactoryGame -Port="${SERVER_PORT:-7777}" -ReliablePort="${RELIABLE_PORT:-8888}"'; \
    } > /usr/local/bin/satisfactory-entrypoint \
    && chmod +x /usr/local/bin/satisfactory-entrypoint

WORKDIR /work
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/satisfactory-entrypoint"]
