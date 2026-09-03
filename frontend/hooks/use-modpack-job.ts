import useSWR from "swr";

import { modpackStatusAction } from "@/actions/mod-browser";
import type { ModpackJob } from "@/lib/mod-browser/types";

const RECENT_JOB_WINDOW_MS = 5 * 60 * 1000;

const POLL_INTERVAL_MS = 1500;

export type ModpackJobState = {
  job: ModpackJob | null;
  installing: boolean;
  recent: boolean;
  refresh: () => Promise<unknown>;
};

export function isJobRecent(job: ModpackJob | null | undefined) {
  if (!job) return false;
  if (job.state === "running") return true;

  return (
    job.finished_at !== null &&
    job.finished_at !== undefined &&
    Date.now() - job.finished_at * 1000 < RECENT_JOB_WINDOW_MS
  );
}

export function useModpackJob(
  serverId: string,
  enabled = true,
): ModpackJobState {
  const { data, mutate } = useSWR(
    enabled && serverId ? ["modpack-status", serverId] : null,
    async () => {
      const result = await modpackStatusAction({ serverId });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? null;
    },
    {
      refreshInterval: (latest) =>
        latest?.state === "running" ? POLL_INTERVAL_MS : 0,
      shouldRetryOnError: false,
    },
  );

  const job = data ?? null;

  return {
    job,
    installing: job?.state === "running",
    recent: isJobRecent(job),
    refresh: mutate,
  };
}
