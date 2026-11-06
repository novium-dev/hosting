#!/bin/bash
set -euo pipefail

steamcmd_dir=/work/steamcmd
# Reforger registers its port with the Bohemia backend, so the backend binds
# the port players connect to inside the container and passes it in here.
game_port="${NOVIUM_PORT_ARMA_REFORGER:-2001}"
a2s_port="${NOVIUM_PORT_A2S:-17777}"
config=config.json
binary=ArmaReforgerServer

cd /work
mkdir -p "$steamcmd_dir" .tmp profile tmp

# The rootfs is read-only, so SteamCMD needs a writable copy of itself.
if [[ ! -x "$steamcmd_dir/steamcmd.sh" ]]; then
  echo "### Installing SteamCMD..."
  cp -r /opt/steamcmd/. "$steamcmd_dir/"
  find "$steamcmd_dir" -type f -name "steamcmd*" -exec chmod +x {} +
fi

if [[ "${AUTO_UPDATE:-1}" == "1" || ! -f "$binary" ]]; then
  steamcmd=("$steamcmd_dir/steamcmd.sh" +force_install_dir /work +login anonymous +app_update "$SRCDS_APPID")

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
    bindAddress: "0.0.0.0",
    bindPort: 2001,
    publicAddress: "",
    publicPort: 2001,
    game: {
      name: "",
      password: "",
      passwordAdmin: "",
      admins: [],
      scenarioId: "",
      maxPlayers: 32,
      visible: true,
      gameProperties: {
        serverMaxViewDistance: 1600,
        serverMinGrassDistance: 50,
        networkViewDistance: 1500,
        disableThirdPerson: false,
        fastValidation: true,
        battlEye: true,
        VONDisableUI: false,
        VONDisableDirectSpeechUI: false
      },
      mods: []
    }
  }' > "$config"
fi

jq \
  --argjson port "$game_port" \
  --argjson a2s "$a2s_port" \
  --arg name "$SERVER_NAME" \
  --arg password "${SERVER_PASSWORD:-}" \
  --arg admin "${ADMIN_PASSWORD:-}" \
  --arg scenario "$SCENARIO_ID" \
  --argjson max "$MAX_PLAYERS" \
  --argjson visible "$VISIBLE" \
  --argjson third "$DISABLE_THIRD_PERSON" \
  --argjson battleye "$BATTLEYE" \
  '.bindAddress = "0.0.0.0"
  | .bindPort = $port
  | .publicPort = $port
  | .a2s = {address: "0.0.0.0", port: $a2s}
  | .game.name = $name
  | .game.password = $password
  | .game.passwordAdmin = $admin
  | .game.scenarioId = $scenario
  | .game.maxPlayers = $max
  | .game.visible = $visible
  | .game.gameProperties.disableThirdPerson = $third
  | .game.gameProperties.battlEye = $battleye' \
  "$config" > "$config.tmp"
mv "$config.tmp" "$config"

args=(
  -gproj ./addons/data/ArmaReforger.gproj
  -config "./$config"
  -profile ./profile
  -addonTempDir ./tmp
  -backendlog
  -nothrow
  -listScenarios
  -logStats "$((${LOG_INTERVAL:-0} * 1000))"
)

if [[ "${MAX_FPS:-0}" != "0" ]]; then
  args+=(-maxFPS "$MAX_FPS")
fi

chmod +x "$binary"

echo "### Starting Arma Reforger on port $game_port, A2S port $a2s_port..."
exec "./$binary" "${args[@]}"
