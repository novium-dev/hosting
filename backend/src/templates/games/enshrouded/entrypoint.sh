#!/bin/bash
set -euo pipefail

steamcmd_dir=/work/steamcmd
# Enshrouded announces its query port, so the backend binds the port players
# connect to inside the container and passes it in here.
query_port="${NOVIUM_PORT_ENSHROUDED:-15637}"
config=enshrouded_server.json
binary=enshrouded_server.exe
log=logs/enshrouded_server.log

cd /work
mkdir -p "$steamcmd_dir" .tmp savegame logs

# The rootfs is read-only, so SteamCMD needs a writable copy of itself.
if [[ ! -x "$steamcmd_dir/steamcmd.sh" ]]; then
  echo "### Installing SteamCMD..."
  cp -r /opt/steamcmd/. "$steamcmd_dir/"
  find "$steamcmd_dir" -type f -name "steamcmd*" -exec chmod +x {} +
fi

if [[ "${AUTO_UPDATE:-1}" == "1" || ! -f "$binary" ]]; then
  # There is no Linux server build, so SteamCMD has to fetch the Windows one.
  steamcmd=("$steamcmd_dir/steamcmd.sh" +@sSteamCmdForcePlatformType windows +force_install_dir /work +login anonymous +app_update "$SRCDS_APPID")

  if [[ "${VALIDATE:-0}" == "1" ]]; then
    steamcmd+=(validate)
  fi

  steamcmd+=(+quit)

  updated=0
  for attempt in 1 2 3; do
    echo "### Updating server files (attempt $attempt)..."
    if "${steamcmd[@]}"; then
      updated=1
      break
    fi
    echo "### SteamCMD exited with an error, retrying in 5s..." >&2
    sleep 5
  done

  if [[ "$updated" != "1" ]]; then
    if [[ ! -f "$binary" ]]; then
      echo "### SteamCMD failed and no server files are installed." >&2
      exit 1
    fi
    echo "### SteamCMD failed, starting the already installed version." >&2
  fi
fi

if [[ ! -f "$binary" ]]; then
  echo "### No $binary found." >&2
  exit 1
fi

if [[ ! -s "$config" ]]; then
  echo "### Creating $config..."
  jq -n '{
    name: "Enshrouded Server",
    saveDirectory: "./savegame",
    logDirectory: "./logs",
    ip: "0.0.0.0",
    queryPort: 15637,
    slotCount: 16,
    gameSettingsPreset: "Default"
  }' > "$config"
fi

jq \
  --arg name "$SERVER_NAME" \
  --argjson port "$query_port" \
  --argjson slots "$MAX_PLAYERS" \
  --arg preset "$DIFFICULTY_PRESET" \
  '.name = $name | .ip = "0.0.0.0" | .queryPort = $port | .slotCount = $slots | .gameSettingsPreset = $preset' \
  "$config" > "$config.tmp"
mv "$config.tmp" "$config"

export WINEPREFIX=/work/.wine \
  WINEARCH=win64 \
  WINEDEBUG=-all \
  WINEDLLOVERRIDES="mscoree,mshtml=" \
  DISPLAY=:99

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp > /dev/null 2>&1 &
xvfb_pid=$!

echo "### Starting Enshrouded on query port $query_port..."
wine "$binary" &
server_pid=$!

stop() {
  kill -TERM "$server_pid" 2> /dev/null || true
}
trap stop TERM INT

# The server only logs to its log file, so it is mirrored to the console.
tail -n 0 -F "$log" --pid="$server_pid" 2> /dev/null &

status=0
while kill -0 "$server_pid" 2> /dev/null; do
  if wait "$server_pid"; then
    status=0
  else
    status=$?
  fi
done

wineserver -k 2> /dev/null || true
kill "$xvfb_pid" 2> /dev/null || true
exit "$status"
