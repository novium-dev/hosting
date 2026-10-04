#!/bin/bash
set -euo pipefail

cd /work
mkdir -p .tmp logs

export LD_LIBRARY_PATH=/opt/teamspeak

voice_port="${NOVIUM_PORT_VOICE:-9987}"
filetransfer_port="${NOVIUM_PORT_FILETRANSFER:-30033}"

echo "### Starting TeamSpeak $TEAMSPEAK_GENERATION server on voice port $voice_port, file transfer port $filetransfer_port..."

case "$TEAMSPEAK_GENERATION" in
  3)
    exec /opt/teamspeak/ts3server \
      license_accepted=1 \
      default_voice_port="$voice_port" \
      filetransfer_port="$filetransfer_port" \
      filetransfer_ip=0.0.0.0,0::0 \
      query_protocols=ssh,http \
      query_ssh_port=10022 \
      query_http_port=10080 \
      dbsqlpath=/opt/teamspeak/sql/ \
      serverquerydocs_path=/opt/teamspeak/serverquerydocs/ \
      logpath=/work/logs/
    ;;
  6)
    exec /opt/teamspeak/tsserver \
      --accept-license \
      --default-voice-port "$voice_port" \
      --filetransfer-port "$filetransfer_port" \
      --query-ssh-enable \
      --query-ssh-port 10022 \
      --query-http-enable \
      --query-http-port 10080 \
      --db-sql-path /opt/teamspeak/sql \
      --query-documentation-path /opt/teamspeak/serverquerydocs \
      --log-path /work/logs
    ;;
  *)
    echo "### Unknown TeamSpeak generation: $TEAMSPEAK_GENERATION" >&2
    exit 1
    ;;
esac
