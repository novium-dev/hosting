import { useMemo } from "react";
import { create } from "zustand";

import {
  EMPTY_SERVER_TASKS,
  NO_TASKS,
  mergeServerTasks,
  taskLock,
  type ServerTaskEntry,
  type ServerTasksSnapshot,
  type TaskAccess,
  type TaskLock,
  type TaskScope,
} from "@/lib/server-tasks";

// Active daemon tasks per server, published by the management bar's stats
// websocket (`TASKS!`) so every section can grey out the actions the daemon
// would refuse while a task holds the storage or server lock.

type ServerTasksState = {
  tasks: Record<string, ServerTasksSnapshot>;
  setTasks: (serverId: string, snapshot: ServerTasksSnapshot) => void;
  forget: (serverId: string) => void;
};

const useServerTasksStore = create<ServerTasksState>((set) => ({
  tasks: {},
  setTasks: (serverId, snapshot) =>
    set((state) => {
      const previous = state.tasks[serverId];
      const merged = mergeServerTasks(previous, snapshot);

      return merged === previous
        ? state
        : { tasks: { ...state.tasks, [serverId]: merged } };
    }),
  forget: (serverId) =>
    set((state) => {
      if (!(serverId in state.tasks)) {
        return state;
      }

      const { [serverId]: _removed, ...tasks } = state.tasks;
      return { tasks };
    }),
}));

export function useServerTasks(serverId: string): ServerTasksSnapshot {
  return useServerTasksStore(
    (state) => state.tasks[serverId] ?? EMPTY_SERVER_TASKS,
  );
}

export function useServerScopeTasks(
  serverId: string,
  scope: TaskScope,
): ServerTaskEntry[] {
  return useServerTasksStore(
    (state) => state.tasks[serverId]?.[scope] ?? NO_TASKS,
  );
}

export function useServerTaskLock(
  serverId: string,
  scope: TaskScope,
  access: TaskAccess,
): TaskLock {
  const tasks = useServerScopeTasks(serverId, scope);

  return useMemo(() => taskLock(tasks, access), [tasks, access]);
}

export function usePublishServerTasks() {
  return useServerTasksStore((state) => state.setTasks);
}

export function useForgetServerTasks() {
  return useServerTasksStore((state) => state.forget);
}
