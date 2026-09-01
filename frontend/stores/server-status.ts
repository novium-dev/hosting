import { create } from "zustand";

import type { ServerLifecycleState } from "@/lib/server-status";

// Last known lifecycle state per server, published by the management bar's
// stats websocket so sections rendered next to it (settings, ...) can gate
// actions that need a stopped server.

type ServerStatusState = {
  statuses: Record<string, ServerLifecycleState>;
  setStatus: (serverId: string, status: ServerLifecycleState) => void;
  forget: (serverId: string) => void;
};

const useServerStatusStore = create<ServerStatusState>((set) => ({
  statuses: {},
  setStatus: (serverId, status) =>
    set((state) =>
      state.statuses[serverId] === status
        ? state
        : { statuses: { ...state.statuses, [serverId]: status } },
    ),
  forget: (serverId) =>
    set((state) => {
      if (!(serverId in state.statuses)) {
        return state;
      }

      const { [serverId]: _removed, ...rest } = state.statuses;
      return { statuses: rest };
    }),
}));

export function useServerStatus(serverId: string): ServerLifecycleState {
  return useServerStatusStore((state) => state.statuses[serverId] ?? "unknown");
}

export function usePublishServerStatus() {
  return useServerStatusStore((state) => state.setStatus);
}

export function useForgetServerStatus() {
  return useServerStatusStore((state) => state.forget);
}
