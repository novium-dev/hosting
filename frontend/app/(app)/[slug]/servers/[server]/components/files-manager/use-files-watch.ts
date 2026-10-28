import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import { watchUser } from "@/lib/api";
import { normalizePath } from "@/lib/files";
import { filesKey, sortFiles, type FileRow } from "./utils";

// Live directory listing over the daemon's files watch websocket. Updates are
// written into the SWR cache of the watched directory, so the regular listing
// stays the single source the files manager renders from.

type WatchEntry =
  | {
      type: "work_directory_changed";
      path: string;
      reason: "changed" | "update" | "delete";
    }
  | { type: "reset"; data: FileRow[] }
  | { type: "add"; index: number; entry: FileRow }
  | { type: "remove"; index: number }
  | { type: "modify"; index: number; entry: FileRow }
  | { type: "move"; index: number; offset: number };

type WatchMessage = {
  token: string;
  data: WatchEntry[];
};

const AUTO_RETRY_LIMIT = 5;
const AUTO_RETRY_BASE_DELAY = 2000;
// The daemon does not answer a work directory change to a missing directory.
const COMMAND_TIMEOUT = 5000;

// Work directory commands resolve against the watched directory, so absolute
// targets are expressed through "..".
function relativePath(from: string, to: string) {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }

  const segments = [
    ...fromParts.slice(common).map(() => ".."),
    ...toParts.slice(common),
  ];

  return segments.length > 0 ? segments.join("/") : ".";
}

function applyEntry(list: FileRow[], entry: WatchEntry) {
  switch (entry.type) {
    case "reset":
      return [...entry.data];
    case "add":
      list.splice(entry.index, 0, entry.entry);
      return list;
    case "remove":
      list.splice(entry.index, 1);
      return list;
    case "modify":
      list[entry.index] = entry.entry;
      return list;
    case "move": {
      const [moved] = list.splice(entry.index, 1);
      if (moved) {
        list.splice(entry.index + entry.offset, 0, moved);
      }
      return list;
    }
    default:
      return list;
  }
}

type FilesWatchOptions = {
  serverId: string;
  path: string;
  enabled: boolean;
  onPathChange: (path: string) => void;
};

export function useFilesWatch({
  serverId,
  path,
  enabled,
  onPathChange,
}: FilesWatchOptions) {
  const { mutate } = useSWRConfig();
  const [attempt, setAttempt] = useState(0);

  const autoRetriesRef = useRef(0);
  const syncRef = useRef<(() => void) | null>(null);
  const pathRef = useRef(path);
  const handlersRef = useRef({ mutate, onPathChange });

  useLayoutEffect(() => {
    pathRef.current = path;
    handlersRef.current = { mutate, onPathChange };
  }, [path, mutate, onPathChange]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let commandTimer: ReturnType<typeof setTimeout> | undefined;
    let list: FileRow[] | null = null;
    // Canonical directory the daemon watches, used to build relative commands.
    let daemonPath: string | null = null;
    // Path as the files manager names it, which differs from daemonPath when
    // it was reached through a symlink.
    let viewPath: string | null = null;
    let pendingPath: string | null = null;
    const initialPath = pathRef.current;

    const scheduleRetry = () => {
      if (autoRetriesRef.current >= AUTO_RETRY_LIMIT) return;

      const delay = AUTO_RETRY_BASE_DELAY * 2 ** autoRetriesRef.current;
      autoRetriesRef.current += 1;
      retryTimer = setTimeout(() => setAttempt((value) => value + 1), delay);
    };

    const sync = () => {
      const target = pathRef.current;
      if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        daemonPath === null ||
        pendingPath !== null ||
        target === viewPath
      ) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "workdirectory",
          path: relativePath(daemonPath, target),
        }),
      );
      pendingPath = target;
      commandTimer = setTimeout(() => {
        pendingPath = null;
      }, COMMAND_TIMEOUT);
    };

    const handleMessage = (message: WatchMessage) => {
      for (const entry of message.data) {
        if (entry.type !== "work_directory_changed") {
          list = applyEntry(list ?? [], entry);
          continue;
        }

        const reported = normalizePath(entry.path);
        const initial = daemonPath === null;
        daemonPath = reported;

        if (entry.reason === "changed") {
          viewPath = pendingPath ?? reported;
          pendingPath = null;
          clearTimeout(commandTimer);
        } else if (initial && entry.reason === "update") {
          viewPath = initialPath;
        } else {
          viewPath = reported;
          if (pendingPath === null && reported !== pathRef.current) {
            handlersRef.current.onPathChange(reported);
          }
        }
      }

      if (list && viewPath !== null) {
        void handlersRef.current.mutate(
          filesKey(serverId, viewPath),
          sortFiles(list),
          { revalidate: false },
        );
      }

      sync();
    };

    const connect = async () => {
      const response = await watchUser({
        path: { server_id: serverId },
        query: initialPath === "/" ? undefined : { file: initialPath.slice(1) },
      });
      if (disposed) return;

      const url = response.data?.url;
      if (response.error || !url) {
        scheduleRetry();
        return;
      }

      const current = new WebSocket(url);
      socket = current;

      current.onopen = () => {
        if (disposed) return;
        autoRetriesRef.current = 0;
      };

      current.onclose = () => {
        if (disposed) return;
        socket = null;
        syncRef.current = null;
        scheduleRetry();
      };

      current.onmessage = (event) => {
        if (disposed || typeof event.data !== "string") return;

        let message: WatchMessage;
        try {
          message = JSON.parse(event.data) as WatchMessage;
        } catch {
          return;
        }
        handleMessage(message);
      };

      syncRef.current = sync;
    };

    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(commandTimer);
      syncRef.current = null;
      socket?.close();
    };
  }, [serverId, enabled, attempt]);

  useEffect(() => {
    syncRef.current?.();
  }, [path]);
}
