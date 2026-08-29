export type ServerPlayer = {
  id: string | null;
  name: string;
};

export type ServerPlayers = {
  online: number;
  max: number | null;
  list: ServerPlayer[] | null;
};

type PlayerSource = (healthCheck: Record<string, unknown>) => ServerPlayers | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMinecraftPlayers(
  healthCheck: Record<string, unknown>,
): ServerPlayers | null {
  const players = asRecord(asRecord(healthCheck.server_info)?.players);
  if (!players) {
    return null;
  }

  const online = asCount(players.online);
  if (online === null) {
    return null;
  }

  const sample = players.Sample ?? players.sample;
  const list = Array.isArray(sample)
    ? sample.flatMap((entry) => {
        const player = asRecord(entry);
        const name = player?.name;

        if (typeof name !== "string") {
          return [];
        }

        return [
          {
            id: typeof player?.id === "string" ? player.id : null,
            name,
          },
        ];
      })
    : [];

  return { online, max: asCount(players.max), list };
}

function readSatisfactoryPlayers(
  healthCheck: Record<string, unknown>,
): ServerPlayers | null {
  const players = asRecord(healthCheck.players);
  const online = asCount(players?.online);

  if (online === null) {
    return null;
  }

  return { online, max: asCount(players?.max), list: null };
}

const PLAYER_SOURCES: Record<string, PlayerSource | undefined> = {
  minecraft: readMinecraftPlayers,
  minecraft_proxy: readMinecraftPlayers,
  satisfactory: readSatisfactoryPlayers,
};

export function supportsPlayers(template: string) {
  return PLAYER_SOURCES[template] !== undefined;
}

function readHealthCheck(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return asRecord(value);
}

export function readHealthCheckPayload(
  message: string,
): Record<string, unknown> | null {
  const raw = message.startsWith("STATS!") ? message.slice(6) : message;

  let payload: Record<string, unknown> | null;
  try {
    payload = asRecord(JSON.parse(raw));
  } catch {
    return null;
  }

  if (!payload) {
    return null;
  }

  const nested = payload.healthcheck ?? payload.health_check;
  if (nested != null) {
    return readHealthCheck(nested);
  }

  return "label" in payload ? null : payload;
}

export function readPlayersFromHealthCheck(
  template: string,
  healthCheck: Record<string, unknown> | null,
): ServerPlayers | null {
  const source = PLAYER_SOURCES[template];

  return source && healthCheck ? source(healthCheck) : null;
}

export function readServerPlayers(
  template: string,
  message: string,
): ServerPlayers | null {
  if (!supportsPlayers(template)) {
    return null;
  }

  return readPlayersFromHealthCheck(template, readHealthCheckPayload(message));
}
