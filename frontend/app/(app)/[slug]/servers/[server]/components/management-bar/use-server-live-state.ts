import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useServerStatsSocket } from "@/hooks/use-server-stats-socket";
import { readServerPlayers, type ServerPlayers } from "@/lib/server-players";
import {
  DISK_USAGE_EVENT,
  buildBaseUsage,
  controlsFromState,
  deriveInitialUsage,
  formatCpuUsage,
  formatUsage,
  parseStatsFrame,
  readControlsFrame,
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

  const applyStats = (payload: Payload) => {
    const nextRunningLimits = readRunningLimits(payload as StatsSnapshot);
    if (nextRunningLimits) {
      setRunningLimits(nextRunningLimits);
    }

    const ramCurrent = payload.ram ?? payload.mem;
    const ramMax = payload.ram_max ?? payload.mem_max ?? ramLimit;
    const cpuCurrent = payload.cpu;
    const cpuMax = payload.cpu_max ?? cpuLimit;
    const diskCurrent = payload.disk ?? payload.storage;
    const diskMax = payload.disk_max ?? payload.storage_max ?? diskLimit;
    const swapMax = payload.swap_max ?? swapLimit;

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
    const { label, time, start, stop, kill } = readControlsFrame(payload);

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

  useServerStatsSocket({
    serverId,
    onMessage: (message) => {
      const tasks = readServerTasks(message);
      if (tasks) {
        publishTasks(serverId, tasks);
        return;
      }

      const players = readServerPlayers(template, message);
      if (players) {
        setPlayers(players);
      }

      const frame = parseStatsFrame(message);
      if (!frame) {
        return;
      }

      if (frame.kind === "stats") {
        applyStats(frame.payload);
      } else {
        applyControls(frame.payload);
      }
    },
    onDisconnect: () => publishTasks(serverId, EMPTY_SERVER_TASKS),
    onConnectFailed: (failure) =>
      toast.error(
        t(
          failure === "request"
            ? "servers:managementBar.toasts.statsConnectFailed"
            : "servers:managementBar.toasts.invalidStatsUrl",
        ),
      ),
  });

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
