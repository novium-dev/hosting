ARG HYTALE_PLATFORM=linux/amd64
FROM --platform=$HYTALE_PLATFORM eclipse-temurin:25-jre

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
        unzip \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/work \
    TMPDIR=/work/.tmp

RUN rm -rf /tmp && ln -s /work/.tmp /tmp

RUN set -eux; \
    { \
        echo '#!/bin/bash'; \
        echo 'set -euo pipefail'; \
        echo ''; \
        echo 'cd /work'; \
        echo 'mkdir -p .tmp'; \
        echo ''; \
        echo 'server_port="${NOVIUM_PORT_HYTALE:-5520}"'; \
        echo 'assets_path="${ASSETS_PATH:-Assets.zip}"'; \
        echo ''; \
        echo 'if [[ ! -x ./hytale-downloader ]]; then'; \
        echo '  echo "### Installing the Hytale downloader..."'; \
        echo '  curl -sSL https://downloader.hytale.com/hytale-downloader.zip -o .tmp/hytale-downloader.zip'; \
        echo '  unzip -qo .tmp/hytale-downloader.zip -d .tmp'; \
        echo '  mv .tmp/hytale-downloader-linux-amd64 ./hytale-downloader'; \
        echo '  chmod +x ./hytale-downloader'; \
        echo '  rm -f .tmp/hytale-downloader.zip'; \
        echo 'fi'; \
        echo ''; \
        echo 'downloader=(./hytale-downloader -skip-update-check)'; \
        echo ''; \
        echo 'if [[ -n "${PATCHLINE:-}" ]]; then'; \
        echo '  downloader+=(-patchline "$PATCHLINE")'; \
        echo 'fi'; \
        echo ''; \
        echo 'if [[ "${AUTO_UPDATE:-1}" == "1" || ! -d ./Server ]]; then'; \
        echo '  if [[ ! -f .hytale-downloader-credentials.json ]]; then'; \
        echo '    echo "### Hytale needs a one time login. Open the URL below and enter the code,"'; \
        echo '    echo "### the download starts by itself once you are done."'; \
        echo '  fi'; \
        echo ''; \
        echo '  rm -f .tmp/version'; \
        echo '  "${downloader[@]}" -print-version | tee .tmp/version || true'; \
        echo '  latest="$(grep -oE "[0-9]+\.[0-9]+\.[0-9]+" .tmp/version 2>/dev/null | head -n 1 || true)"'; \
        echo '  installed=""'; \
        echo '  if [[ -f .current_version ]]; then'; \
        echo '    installed="$(cat .current_version)"'; \
        echo '  fi'; \
        echo ''; \
        echo '  echo "### Installed: ${installed:-none}, latest: ${latest:-unknown}"'; \
        echo ''; \
        echo '  if [[ -z "$latest" || "$installed" != "$latest" || ! -d ./Server ]]; then'; \
        echo '    echo "### Downloading server files, this can take a while..."'; \
        echo '    if "${downloader[@]}"; then'; \
        echo '      if [[ -n "$latest" ]]; then'; \
        echo '        echo "$latest" > .current_version'; \
        echo '      fi'; \
        echo '      echo "### Download complete."'; \
        echo '    elif [[ -d ./Server ]]; then'; \
        echo '      echo "### Download failed, starting the installed version." >&2'; \
        echo '    else'; \
        echo '      echo "### Download failed and no server files are installed." >&2'; \
        echo '      exit 1'; \
        echo '    fi'; \
        echo '  else'; \
        echo '    echo "### Server files are up to date."'; \
        echo '  fi'; \
        echo 'fi'; \
        echo ''; \
        echo 'if [[ ! -f "$assets_path" ]]; then'; \
        echo '  echo "### Assets archive $assets_path not found." >&2'; \
        echo '  exit 1'; \
        echo 'fi'; \
        echo ''; \
        echo 'if [[ ! -f ./Server/HytaleServer.jar ]]; then'; \
        echo '  echo "### Server/HytaleServer.jar not found." >&2'; \
        echo '  exit 1'; \
        echo 'fi'; \
        echo ''; \
        echo 'args=(--assets "$assets_path" --auth-mode "${AUTH_MODE:-authenticated}" --bind "0.0.0.0:$server_port" --transport QUIC)'; \
        echo ''; \
        echo 'if [[ "${ACCEPT_EARLY_PLUGINS:-0}" == "1" ]]; then'; \
        echo '  args+=(--accept-early-plugins)'; \
        echo 'fi'; \
        echo ''; \
        echo 'if [[ "${ALLOW_OP:-0}" == "1" ]]; then'; \
        echo '  args+=(--allow-op)'; \
        echo 'fi'; \
        echo ''; \
        echo 'if [[ "${ENABLE_BACKUPS:-0}" == "1" ]]; then'; \
        echo '  args+=(--backup --backup-dir "${BACKUP_DIR:-backups}" --backup-frequency "${BACKUP_FREQUENCY:-60}")'; \
        echo 'fi'; \
        echo ''; \
        echo 'echo "### Starting Hytale on UDP port $server_port..."'; \
        echo ''; \
        echo 'exec java -Xms128M -XX:MaxRAMPercentage=95.0 -Djava.io.tmpdir=/work/.tmp -Dterminal.jline=false -Dterminal.ansi=true -jar ./Server/HytaleServer.jar "${args[@]}"'; \
    } > /usr/local/bin/hytale-entrypoint \
    && chmod +x /usr/local/bin/hytale-entrypoint

WORKDIR /work
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hytale-entrypoint"]
