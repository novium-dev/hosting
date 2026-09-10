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
        echo 'archive="game.zip"'; \
        echo ''; \
        echo 'find_jar() {'; \
        echo '  find . -maxdepth 3 -type f -name HytaleServer.jar -print -quit 2>/dev/null || true'; \
        echo '}'; \
        echo ''; \
        echo 'find_assets() {'; \
        echo '  if [[ -n "${ASSETS_PATH:-}" && -f "${ASSETS_PATH:-}" ]]; then'; \
        echo '    printf "%s" "$ASSETS_PATH"'; \
        echo '    return'; \
        echo '  fi'; \
        echo ''; \
        echo '  local detected'; \
        echo '  detected="$(find . -maxdepth 3 -type f -name "Assets*.zip" -print -quit 2>/dev/null || true)"'; \
        echo ''; \
        echo '  if [[ -n "$detected" ]]; then'; \
        echo '    printf "%s" "$detected"'; \
        echo '  elif [[ -f "$archive" ]]; then'; \
        echo '    printf "%s" "$archive"'; \
        echo '  fi'; \
        echo '}'; \
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
        echo 'jar="$(find_jar)"'; \
        echo ''; \
        echo 'if [[ "${AUTO_UPDATE:-1}" == "1" || -z "$jar" ]]; then'; \
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
        echo '  if [[ -z "$latest" || "$installed" != "$latest" || -z "$jar" ]]; then'; \
        echo '    echo "### Downloading server files, this can take a while..."'; \
        echo '    rm -f "$archive"'; \
        echo ''; \
        echo '    if "${downloader[@]}" -download-path "$archive"; then'; \
        echo '      echo "### Extracting $archive..."'; \
        echo '      unzip -qo "$archive" -d .'; \
        echo '      jar="$(find_jar)"'; \
        echo ''; \
        echo '      if [[ -n "$latest" ]]; then'; \
        echo '        echo "$latest" > .current_version'; \
        echo '      fi'; \
        echo ''; \
        echo '      echo "### Download complete."'; \
        echo '    elif [[ -n "$jar" ]]; then'; \
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
        echo 'if [[ -z "$jar" ]]; then'; \
        echo '  echo "### HytaleServer.jar not found. /work contains:" >&2'; \
        echo '  ls -1 >&2'; \
        echo '  exit 1'; \
        echo 'fi'; \
        echo ''; \
        echo 'assets="$(find_assets)"'; \
        echo ''; \
        echo 'if [[ -z "$assets" ]]; then'; \
        echo '  echo "### No assets archive found, set the assets path variable. /work contains:" >&2'; \
        echo '  ls -1 >&2'; \
        echo '  exit 1'; \
        echo 'fi'; \
        echo ''; \
        echo 'echo "### Using jar $jar with assets $assets"'; \
        echo ''; \
        echo 'args=(--assets "$assets" --auth-mode "${AUTH_MODE:-authenticated}" --bind "0.0.0.0:$server_port" --transport QUIC)'; \
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
        echo 'exec java -Xms128M -XX:MaxRAMPercentage=95.0 -Djava.io.tmpdir=/work/.tmp -Dterminal.jline=false -Dterminal.ansi=true -jar "$jar" "${args[@]}"'; \
    } > /usr/local/bin/hytale-entrypoint \
    && chmod +x /usr/local/bin/hytale-entrypoint

# The daemon starts the server as this uid and mounts the storage at /work. Without a
# matching entry the uid resolves to no user at all and everything that looks up the home
# directory falls back to /, which is read-only. An id of the base image that collides is
# dropped, so that ours is the entry that resolves.
ARG CONTAINER_UID=25335
ARG CONTAINER_GID=25335
RUN sed -i "/^[^:]*:[^:]*:${CONTAINER_UID}:/d" /etc/passwd \
    && sed -i "/^[^:]*:[^:]*:${CONTAINER_GID}:/d" /etc/group \
    && echo "container:x:${CONTAINER_UID}:${CONTAINER_GID}::/work:/bin/sh" >> /etc/passwd \
    && echo "container:x:${CONTAINER_GID}:" >> /etc/group

WORKDIR /work
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hytale-entrypoint"]
