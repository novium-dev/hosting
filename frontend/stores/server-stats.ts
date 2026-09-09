import { create } from "zustand";

// Rolling resource-usage history per server, published by the management bar's
// stats websocket so the console's graphs can render a timeline without opening
// a second socket. Values that a snapshot leaves out are carried over from the
// previous sample: the daemon reports disk from its storage worker and cpu/ram
// from the container watcher, so most payloads only fill in one side.

export type StatsSample = {
  at: number;
  cpu: number | null;
  cpuMax: number | null;
  ram: number | null;
  ramMax: number | null;
  disk: number | null;
  diskMax: number | null;
};

export const STATS_HISTORY_LIMIT = 180;

const EMPTY: StatsSample[] = [];

type ServerStatsState = {
  history: Record<string, StatsSample[]>;
  push: (serverId: string, sample: StatsSample) => void;
  forget: (serverId: string) => void;
};

function carryOver(sample: StatsSample, previous: StatsSample | undefined) {
  if (!previous) return sample;

  return {
    at: sample.at,
    cpu: sample.cpu ?? previous.cpu,
    cpuMax: sample.cpuMax ?? previous.cpuMax,
    ram: sample.ram ?? previous.ram,
    ramMax: sample.ramMax ?? previous.ramMax,
    disk: sample.disk ?? previous.disk,
    diskMax: sample.diskMax ?? previous.diskMax,
  };
}

const useServerStatsStore = create<ServerStatsState>((set) => ({
  history: {},
  push: (serverId, sample) =>
    set((state) => {
      const previous = state.history[serverId] ?? EMPTY;
      const next = previous.concat(
        carryOver(sample, previous[previous.length - 1]),
      );

      return {
        history: {
          ...state.history,
          [serverId]:
            next.length > STATS_HISTORY_LIMIT
              ? next.slice(next.length - STATS_HISTORY_LIMIT)
              : next,
        },
      };
    }),
  forget: (serverId) =>
    set((state) => {
      if (!(serverId in state.history)) {
        return state;
      }

      const { [serverId]: _removed, ...rest } = state.history;
      return { history: rest };
    }),
}));

export function useServerStatsHistory(serverId: string): StatsSample[] {
  return useServerStatsStore((state) => state.history[serverId] ?? EMPTY);
}

export function usePublishServerStats() {
  return useServerStatsStore((state) => state.push);
}

export function useForgetServerStats() {
  return useServerStatsStore((state) => state.forget);
}
