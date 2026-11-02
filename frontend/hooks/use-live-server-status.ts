import { useEffect, useRef, useState } from "react";

import { useServerStatsSocket } from "@/hooks/use-server-stats-socket";
import {
  controlsFromState,
  parseStatsFrame,
  readControlsFrame,
  statusFromLabel,
  type ControlState,
  type ServerLifecycleState,
  type StatsSnapshot,
} from "@/lib/server-status";
import { EMPTY_SERVER_TASKS, readServerTasks } from "@/lib/server-tasks";
import {
  useForgetServerTasks,
  usePublishServerTasks,
} from "@/stores/server-tasks";

export type ServerStatusSnapshot = {
  state: string;
  started_at?: number | null;
  stats?: StatsSnapshot | null;
};

type LiveControls = {
  status: ServerLifecycleState;
  startedAt: number | null;
  controls: ControlState;
};

/**
 * Keeps a list entry's status current over the stats websocket, falling back to
 * the `list_servers` snapshot until the daemon has sent something. A stopped
 * server only produces a frame every 30 seconds, so the snapshot stays relevant.
 */
export function useLiveServerStatus(
  serverId: string,
  snapshot: ServerStatusSnapshot | null | undefined,
) {
  const [liveControls, setLiveControls] = useState<LiveControls | null>(null);
  const [liveStats, setLiveStats] = useState<StatsSnapshot | null>(null);

  // The daemon opens every connection with a placeholder frame that reports
  // "Stopped" even for a running server, the real state follows with the next
  // watcher tick.
  const awaitingPlaceholderRef = useRef(true);

  const publishTasks = usePublishServerTasks();
  const forgetTasks = useForgetServerTasks();

  useEffect(() => () => forgetTasks(serverId), [forgetTasks, serverId]);

  useServerStatsSocket({
    serverId,
    reconnect: true,
    onConnect: () => {
      awaitingPlaceholderRef.current = true;
    },
    onMessage: (message) => {
      const tasks = readServerTasks(message);
      if (tasks) {
        publishTasks(serverId, tasks);
        return;
      }

      const frame = parseStatsFrame(message);
      if (!frame) {
        return;
      }

      if (frame.kind === "stats") {
        setLiveStats(frame.payload as StatsSnapshot);
        return;
      }

      if (awaitingPlaceholderRef.current) {
        awaitingPlaceholderRef.current = false;
        return;
      }

      const { label, time, start, stop, kill } = readControlsFrame(
        frame.payload,
      );
      if (!label) {
        return;
      }

      const status = statusFromLabel(label);
      const fallback = controlsFromState(status);

      setLiveControls({
        status,
        startedAt: time !== null && time > 0 ? time : null,
        controls: {
          canStart: start ?? fallback.canStart,
          canStop: stop ?? fallback.canStop,
          canKill: kill ?? fallback.canKill,
        },
      });
    },
    onDisconnect: () => {
      setLiveControls(null);
      setLiveStats(null);
      publishTasks(serverId, EMPTY_SERVER_TASKS);
    },
  });

  const status =
    liveControls?.status ??
    (snapshot ? statusFromLabel(snapshot.state) : "unknown");

  return {
    status,
    startedAt: liveControls
      ? liveControls.startedAt
      : (snapshot?.started_at ?? null),
    stats: liveStats ?? snapshot?.stats ?? null,
    controls: liveControls?.controls ?? controlsFromState(status),
  };
}
