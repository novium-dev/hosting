import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { serverStats } from "@/lib/api";
import { readServerPlayers, type ServerPlayers } from "@/lib/server-players";
import {
  DISK_USAGE_EVENT,
  buildBaseUsage,
  controlsFromState,
  deriveInitialUsage,
  formatCpuUsage,
  formatUsage,
  readRunningLimits,
  statusFromLabel,
  toFiniteNumber,
  usagePercentValue,
  type ControlState,
  type DiskUsageEventDetail,
  type RunningLimits,
  type ServerLifecycleState,
  type StatsSnapshot,
  type UsagePercents,
  type UsageState,
} from "@/lib/server-status";
import { EMPTY_SERVER_TASKS, readServerTasks } from "@/lib/server-tasks";
import {
  useForgetServerStats,
  usePublishServerStats,
} from "@/stores/server-stats";
import {
  useForgetServerStatus,
  usePublishServerStatus,
} from "@/stores/server-status";
import {
  useForgetServerTasks,
  usePublishServerTasks,
} from "@/stores/server-tasks";

export type ServerLimits = {
  cpuLimit: number | null;
  diskLimit: number | null;
  ramLimit: number | null;
  swapLimit: number | null;
};

type Payload = Record<string, unknown>;

function readString(data: Payload, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function readBoolean(data: Payload, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function parseJson(message: string) {
  try {
    return JSON.parse(message) as Payload;
  } catch {
    return null;
  }
}

export function useServerLiveState({
  serverId,
  template,
  limits,
  initialState,
  initialStartedAt,
  initialStats,
}: {
  serverId: string;
  template: string;
  limits: ServerLimits;
  initialState?: string | null;
  initialStartedAt?: number | null;
  initialStats?: StatsSnapshot | null;
}) {
  const { t } = useTranslation();
  const { cpuLimit, diskLimit, ramLimit, swapLimit } = limits;
  const initialUsage = deriveInitialUsage(
    initialStats,
    limits,
    buildBaseUsage(limits),
  );
  const seededStatus: ServerLifecycleState = initialState
    ? statusFromLabel(initialState)
    : "unknown";

  const [status, setStatus] = useState(seededStatus);
  const [usage, setUsage] = useState<UsageState>(initialUsage.usage);
  const [usagePercents, setUsagePercents] = useState<UsagePercents>(
    initialUsage.percents,
  );
  const [startedAt, setStartedAt] = useState(initialStartedAt ?? null);
  const [livePlayers, setPlayers] = useState<ServerPlayers | null>(null);
  const [controls, setControls] = useState<ControlState>(() =>
    controlsFromState(seededStatus),
  );
  const [liveRunningLimits, setRunningLimits] = useState<RunningLimits | null>(
    () => readRunningLimits(initialStats),
  );
  const [seededFrom, setSeededFrom] = useState({ initialStats, ...limits });

  if (
    seededFrom.initialStats !== initialStats ||
    seededFrom.cpuLimit !== cpuLimit ||
    seededFrom.diskLimit !== diskLimit ||
    seededFrom.ramLimit !== ramLimit ||
    seededFrom.swapLimit !== swapLimit
  ) {
    setSeededFrom({ initialStats, cpuLimit, diskLimit, ramLimit, swapLimit });
    setUsage(initialUsage.usage);
    setUsagePercents(initialUsage.percents);
  }

  const publishStatus = usePublishServerStatus();
  const forgetStatus = useForgetServerStatus();
  const publishStats = usePublishServerStats();
  const forgetStats = useForgetServerStats();
  const publishTasks = usePublishServerTasks();
  const forgetTasks = useForgetServerTasks();

  useEffect(() => {
    publishStatus(serverId, status);
  }, [publishStatus, serverId, status]);

  useEffect(
    () => () => {
      forgetStatus(serverId);
      forgetStats(serverId);
      forgetTasks(serverId);
    },
    [forgetStatus, forgetStats, forgetTasks, serverId],
  );

  const limitsRef = useRef(limits);
  useLayoutEffect(() => {
    limitsRef.current = { cpuLimit, diskLimit, ramLimit, swapLimit };
  }, [cpuLimit, diskLimit, ramLimit, swapLimit]);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;

    const applyStats = (payload: Payload) => {
      const nextRunningLimits = readRunningLimits(payload as StatsSnapshot);
      if (nextRunningLimits) {
        setRunningLimits(nextRunningLimits);
      }

      const current = limitsRef.current;
      const ramCurrent = payload.ram ?? payload.mem;
      const ramMax = payload.ram_max ?? payload.mem_max ?? current.ramLimit;
      const cpuCurrent = payload.cpu;
      const cpuMax = payload.cpu_max ?? current.cpuLimit;
      const diskCurrent = payload.disk ?? payload.storage;
      const diskMax =
        payload.disk_max ?? payload.storage_max ?? current.diskLimit;
      const swapMax = payload.swap_max ?? current.swapLimit;

      setUsage({
        cpu: formatCpuUsage(cpuCurrent, cpuMax),
        ram: formatUsage(ramCurrent, ramMax),
        disk: formatUsage(diskCurrent, diskMax),
        swap: swapMax === 0 ? "Disabled" : formatUsage(payload.swap, swapMax),
      });

      publishStats(serverId, {
        at: Date.now(),
        cpu: toFiniteNumber(cpuCurrent),
        cpuMax: toFiniteNumber(cpuMax),
        ram: toFiniteNumber(ramCurrent),
        ramMax: toFiniteNumber(ramMax),
        disk: toFiniteNumber(diskCurrent),
        diskMax: toFiniteNumber(diskMax),
      });

      const diskPercent = usagePercentValue(diskCurrent, diskMax);

      setUsagePercents({
        cpu: usagePercentValue(cpuCurrent, cpuMax),
        ram: usagePercentValue(ramCurrent, ramMax),
        disk: diskPercent,
      });

      window.dispatchEvent(
        new CustomEvent<DiskUsageEventDetail>(DISK_USAGE_EVENT, {
          detail: { serverId, percent: diskPercent },
        }),
      );
    };

    const applyControls = (payload: Payload) => {
      const label = readString(payload, ["label", "LABEL"]);
      const time = toFiniteNumber(payload.time ?? payload.TIME);
      const start = readBoolean(payload, ["start", "START"]);
      const stop = readBoolean(payload, ["stop", "STOP"]);
      const kill = readBoolean(payload, ["kill", "KILL"]);

      if (label) {
        setStatus(statusFromLabel(label));
      }

      setStartedAt(time !== null && time > 0 ? time : null);
      setControls((previous) => ({
        canStart: start ?? previous.canStart,
        canStop: stop ?? previous.canStop,
        canKill: kill ?? previous.canKill,
      }));
    };

    const onMessage = (message: string) => {
      const tasks = readServerTasks(message);
      if (tasks) {
        publishTasks(serverId, tasks);
        return;
      }

      const players = readServerPlayers(template, message);
      if (players) {
        setPlayers(players);
      }

      const payload = message.startsWith("STATS!")
        ? parseJson(message.slice(6))
        : parseJson(message);

      if (!payload) {
        return;
      }

      if (message.startsWith("STATS!")) {
        applyStats(payload);
      } else {
        applyControls(payload);
      }
    };

    const onDisconnect = () => {
      if (mounted) {
        publishTasks(serverId, EMPTY_SERVER_TASKS);
      }
    };

    const connect = async () => {
      try {
        const response = await serverStats({ path: { server_id: serverId } });

        if (!mounted) {
          return;
        }

        if (response.error || !response.data) {
          toast.error(
            t(
              response.error
                ? "servers:managementBar.toasts.statsConnectFailed"
                : "servers:managementBar.toasts.invalidStatsUrl",
            ),
          );
          return;
        }

        socket = new WebSocket(response.data);
        socket.binaryType = "arraybuffer";
        socket.onerror = onDisconnect;
        socket.onclose = onDisconnect;
        socket.onmessage = (event) => {
          if (mounted && typeof event.data === "string") {
            onMessage(event.data);
          }
        };
      } catch {
        if (mounted) {
          toast.error(t("servers:managementBar.toasts.statsConnectFailed"));
        }
      }
    };

    void connect();

    return () => {
      mounted = false;
      socket?.close();
    };
  }, [serverId, template, publishTasks, publishStats, t]);

  const running = status === "running";

  return {
    status,
    usage,
    usagePercents,
    startedAt,
    controls,
    players: running ? livePlayers : null,
    runningLimits: running || status === "unhealthy" ? liveRunningLimits : null,
  };
}
