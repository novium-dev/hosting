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

# Pristine SteamCMD. The container rootfs is read-only at runtime and SteamCMD
# writes into its own directory, so this is only a template that gets copied
# into /work on first start.
RUN mkdir -p /opt/steamcmd \
    && curl -sSL https://media.steampowered.com/client/installer/steamcmd_linux.tar.gz \
        | tar -xz -C /opt/steamcmd \
    && chmod -R a+rX /opt/steamcmd \
    && chmod a+x /opt/steamcmd/steamcmd.sh /opt/steamcmd/linux32/steamcmd

# /work is the only writable path, so HOME and TMPDIR have to live there.
# .tmp/ is excluded from backups by the daemon.
ENV HOME=/work \
    TMPDIR=/work/.tmp

# Steam's crash handler insists on creating /tmp/dumps and aborts if it cannot,
# which a read-only rootfs guarantees. The entrypoint creates the target.
RUN rm -rf /tmp && ln -s /work/.tmp /tmp

RUN set -eux; \
    { \
        echo '#!/bin/bash'; \
        echo 'set -euo pipefail'; \
        echo 'shopt -s nullglob'; \
        echo ''; \
        echo 'steamcmd_dir=/work/steamcmd'; \
        echo '# Satisfactory cannot be remapped, so the backend binds the port'; \
        echo '# players connect to inside the container and passes it in here.'; \
        echo 'server_port="${NOVIUM_PORT_SATISFACTORY_TCP:-7777}"'; \
        echo 'reliable_port="${NOVIUM_PORT_RELIABLE_MESSAGING:-8888}"'; \
        echo ''; \
        echo 'cd /work'; \
        echo 'mkdir -p "$steamcmd_dir" .steam/sdk32 .steam/sdk64 .tmp FactoryGame/Saved/Config/LinuxServer'; \
        echo ''; \
        echo '# The rootfs is read-only, so SteamCMD needs a writable copy of itself.'; \
        echo 'if [[ ! -x "$steamcmd_dir/steamcmd.sh" ]]; then'; \
        echo '  echo "### Installing SteamCMD..."'; \
        echo '  cp -r /opt/steamcmd/. "$steamcmd_dir/"'; \
        echo '  find "$steamcmd_dir" -type f -name "steamcmd*" -exec chmod +x {} +'; \
        echo 'fi'; \
        echo ''; \
        echo 'binaries=(Engine/Binaries/Linux/*-Linux-Shipping)'; \
        echo ''; \
        echo 'if [[ "${AUTO_UPDATE:-1}" == "1" || ${#binaries[@]} -eq 0 ]]; then'; \
        echo '  steamcmd=("$steamcmd_dir/steamcmd.sh" +force_install_dir /work +login anonymous +app_update "$SRCDS_APPID")'; \
        echo ''; \
        echo '  if [[ -n "${SRCDS_BETAID:-}" ]]; then'; \
        echo '    steamcmd+=(-beta "$SRCDS_BETAID")'; \
        echo '  fi'; \
        echo ''; \
        echo '  if [[ -n "${SRCDS_BETAPASS:-}" ]]; then'; \
        echo '    steamcmd+=(-betapassword "$SRCDS_BETAPASS")'; \
        echo '  fi'; \
        echo ''; \
        echo '  if [[ "${VALIDATE:-0}" == "1" ]]; then'; \
        echo '    steamcmd+=(validate)'; \
        echo '  fi'; \
        echo ''; \
        echo '  steamcmd+=(+quit)'; \
        echo ''; \
        echo '  updated=0'; \
        echo '  for attempt in 1 2 3; do'; \
        echo '    echo "### Updating server files (attempt $attempt)..."'; \
        echo '    if "${steamcmd[@]}"; then'; \
        echo '      updated=1'; \
        echo '      break'; \
        echo '    fi'; \
        echo '    echo "### SteamCMD exited with an error, retrying in 5s..." >&2'; \
        echo '    sleep 5'; \
        echo '  done'; \
        echo ''; \
        echo '  binaries=(Engine/Binaries/Linux/*-Linux-Shipping)'; \
        echo ''; \
        echo '  if [[ "$updated" != "1" ]]; then'; \
        echo '    if [[ ${#binaries[@]} -eq 0 ]]; then'; \
        echo '      echo "### SteamCMD failed and no server files are installed." >&2'; \
        echo '      exit 1'; \
        echo '    fi'; \
        echo '    echo "### SteamCMD failed, starting the already installed version." >&2'; \
        echo '  fi'; \
        echo 'fi'; \
        echo ''; \
        echo 'if [[ ${#binaries[@]} -eq 0 ]]; then'; \
        echo '  echo "### No server binary found in Engine/Binaries/Linux." >&2'; \
        echo '  exit 1'; \
        echo 'fi'; \
        echo ''; \
        echo '# The Steam API is loaded from $HOME/.steam and only exists once SteamCMD has bootstrapped.'; \
        echo 'for bits in 32 64; do'; \
        echo '  steamclient="$steamcmd_dir/linux$bits/steamclient.so"'; \
        echo '  if [[ -f "$steamclient" ]]; then'; \
        echo '    cp -f "$steamclient" ".steam/sdk$bits/steamclient.so"'; \
        echo '  fi'; \
        echo 'done'; \
        echo ''; \
        echo 'binary="${binaries[0]}"'; \
        echo 'chmod +x "$binary"'; \
        echo ''; \
        echo 'echo "### Starting Satisfactory ($binary) on port $server_port, reliable port $reliable_port..."'; \
        echo 'exec "$binary" FactoryGame -Port="$server_port" -ServerAPIPort="$server_port" -ReliablePort="$reliable_port" -Unattended -Log'; \
    } > /usr/local/bin/satisfactory-entrypoint \
    && chmod +x /usr/local/bin/satisfactory-entrypoint

WORKDIR /work
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/satisfactory-entrypoint"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15m --retries=5 \
    CMD curl -sSk --fail "https://localhost:${NOVIUM_PORT_SATISFACTORY_TCP:-7777}/api/v1" \
        -H "Content-Type: application/json" \
        -d '{"function":"HealthCheck","data":{"clientCustomData":""}}'
