import type {
  NetworkPort,
  NetworkProtocol,
  ServerInfoResponse,
} from "@/lib/api";

export type AdminPortRow = {
  id: number;
  name: string;
  protocol: NetworkProtocol;
  internalPort: number;
  externalStart: number;
  externalEnd: number;
  host: string;
  bind: string | null;
  http: boolean;
};

type RawPortCandidate = Partial<NetworkPort> & {
  external_port?: number;
};

function toFiniteNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeProtocol(value: string | null | undefined): NetworkProtocol {
  return value?.toLowerCase() === "udp" ? "udp" : "tcp";
}

function parsePortCandidate(
  candidate: RawPortCandidate | null | undefined,
): AdminPortRow | null {
  if (!candidate) {
    return null;
  }

  const id = toFiniteNumber(candidate.id);
  const internalPort = toFiniteNumber(candidate.internal_port);
  const externalStart =
    toFiniteNumber(candidate.external_port_start) ??
    toFiniteNumber(candidate.external_port);
  const externalEnd =
    toFiniteNumber(candidate.external_port_end) ??
    toFiniteNumber(candidate.external_port);
  const host =
    typeof candidate.host === "string" && candidate.host.trim().length > 0
      ? candidate.host
      : null;

  if (
    id === null ||
    internalPort === null ||
    externalStart === null ||
    externalEnd === null ||
    host === null
  ) {
    return null;
  }

  return {
    id,
    name:
      typeof candidate.name === "string" && candidate.name.trim().length > 0
        ? candidate.name
        : `Port ${id}`,
    protocol: normalizeProtocol(candidate.protocol),
    internalPort,
    externalStart,
    externalEnd,
    host,
    bind: typeof candidate.bind === "string" ? candidate.bind : null,
    http: candidate.http === true,
  };
}

export function extractAdminPorts(serverData: ServerInfoResponse): AdminPortRow[] {
  const byId = new Map<number, AdminPortRow>();

  const register = (row: AdminPortRow | null) => {
    if (!row) {
      return;
    }

    byId.set(row.id, row);
  };

  if (Array.isArray(serverData.network?.ports)) {
    for (const candidate of serverData.network.ports) {
      register(parsePortCandidate(candidate));
    }
  }

  const primary = serverData.primary_port;
  if (primary) {
    const base = parsePortCandidate(primary.port);
    if (base) {
      const external = toFiniteNumber(primary.external_port);
      register({
        ...base,
        externalStart: external ?? base.externalStart,
        externalEnd: external ?? base.externalEnd,
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}
