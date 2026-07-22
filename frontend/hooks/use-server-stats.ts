"use client";

import { useEffect, useState } from "react";

import { serverStats } from "@/lib/api";

export type ServerLiveState =
  | "stopped"
  | "starting"
  | "unhealthy"
  | "running"
  | "stopping"
  | "restarting"
  | "locked"
  | "unknown";

export type StatsConnection = "connecting" | "connected" | "disconnected";

export type ServerLiveStats = {
  connection: StatsConnection;
  /** Lifecycle state derived from the daemon status label. */
  state: ServerLiveState;
  /** Epoch millis the server started, or null when not running. */
  startedAt: number | null;
  /** CPU usage as a percentage of the limit (0-100), or null. */
  cpu: number | null;
  /** RAM usage as a percentage of the limit (0-100), or null. */
  ram: number | null;
  /** Disk usage as a percentage of the limit (0-100), or null. */
  disk: number | null;
};

const INITIAL: ServerLiveStats = {
  connection: "connecting",
  state: "unknown",
  startedAt: null,
  cpu: null,
  ram: null,
  disk: null,
};

function toFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function usagePercent(current: unknown, max: unknown): number | null {
  const currentNumber = toFiniteNumber(current);
  const maxNumber = toFiniteNumber(max);
  return currentNumber !== null && maxNumber !== null && maxNumber > 0
    ? (currentNumber / maxNumber) * 100
    : null;
}

function stateFromLabel(label: string): ServerLiveState {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("locked")) return "locked";
  if (normalized.includes("unhealthy")) return "unhealthy";
  if (normalized.includes("restarting")) return "restarting";
  if (normalized.includes("starting")) return "starting";
  if (normalized.includes("stopping")) return "stopping";
  if (["running", "online"].includes(normalized)) return "running";
  if (["stopped", "offline", "crashed"].includes(normalized)) return "stopped";
  return "unknown";
}

/**
 * Subscribes to a server's live stats websocket and returns its current
 * lifecycle state, uptime anchor and CPU/RAM/disk usage percentages.
 *
 * The subscription only runs while `enabled` is true, so list views can opt
 * out of the (per-server) websocket connection where the extra data isn't
 * needed.
 */
export function useServerStats(
  serverId: string,
  enabled: boolean,
): ServerLiveStats {
  const [stats, setStats] = useState<ServerLiveStats>(INITIAL);

  useEffect(() => {
    if (!enabled) {
      setStats(INITIAL);
      return;
    }

    let mounted = true;
    let socket: WebSocket | null = null;

    setStats(INITIAL);

    const connect = async () => {
      try {
        const statsUrl = await serverStats({ path: { server_id: serverId } });
        const socketUrl = statsUrl.error ? null : statsUrl.data;

        if (!socketUrl) {
          if (mounted) {
            setStats((prev) => ({ ...prev, connection: "disconnected" }));
          }
          return;
        }

        socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";

        socket.onopen = () => {
          if (mounted) {
            setStats((prev) => ({ ...prev, connection: "connected" }));
          }
        };

        socket.onerror = socket.onclose = () => {
          if (mounted) {
            setStats((prev) => ({ ...prev, connection: "disconnected" }));
          }
        };

        socket.onmessage = (event) => {
          if (!mounted || typeof event.data !== "string") {
            return;
          }

          const message = event.data;

          if (message.startsWith("STATS!")) {
            try {
              const payload = JSON.parse(message.slice(6)) as Record<
                string,
                unknown
              >;

              const ramCurrent = payload.ram ?? payload.mem;
              const ramMax = payload.ram_max ?? payload.mem_max;
              const cpuCurrent = payload.cpu ?? payload.cpu_absolute;
              const cpuMax = payload.cpu_max;
              const diskCurrent = payload.disk ?? payload.storage;
              const diskMax = payload.disk_max ?? payload.storage_max;

              setStats((prev) => ({
                ...prev,
                cpu: usagePercent(cpuCurrent, cpuMax),
                ram: usagePercent(ramCurrent, ramMax),
                disk: usagePercent(diskCurrent, diskMax),
              }));
            } catch {
              // Ignore malformed stats payloads.
            }

            return;
          }

          try {
            const payload = JSON.parse(message) as Record<string, unknown>;
            const label = payload.label ?? payload.LABEL;
            const time = toFiniteNumber(payload.time ?? payload.TIME);

            setStats((prev) => ({
              ...prev,
              state:
                typeof label === "string" && label.trim().length > 0
                  ? stateFromLabel(label)
                  : prev.state,
              startedAt: time !== null && time > 0 ? time : null,
            }));
          } catch {
            // Ignore malformed control payloads.
          }
        };
      } catch {
        if (mounted) {
          setStats((prev) => ({ ...prev, connection: "disconnected" }));
        }
      }
    };

    void connect();

    return () => {
      mounted = false;
      socket?.close();
    };
  }, [serverId, enabled]);

  return stats;
}
