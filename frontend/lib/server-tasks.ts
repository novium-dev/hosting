import type { TFunction } from "i18next";

export const TASKS_MESSAGE_PREFIX = "TASKS!";

export type TaskScope = "storage" | "server";

export type TaskAccess = "read" | "write";

export type TaskProgress = {
  current: number;
  max: number | null;
};

export type ServerTaskEntry = {
  id: number;
  time: number;
  write: boolean;
  kind: string;
  detail: string | null;
  progress: TaskProgress | null;
};

export type ServerTasksSnapshot = {
  storage: ServerTaskEntry[];
  server: ServerTaskEntry[];
};

export type TaskLock = {
  tasks: ServerTaskEntry[];
  blocking: ServerTaskEntry | null;
  locked: boolean;
};

export const NO_TASKS: ServerTaskEntry[] = [];

export const EMPTY_SERVER_TASKS: ServerTasksSnapshot = {
  storage: NO_TASKS,
  server: NO_TASKS,
};

export const UNLOCKED: TaskLock = {
  tasks: NO_TASKS,
  blocking: null,
  locked: false,
};

const DESCRIPTOR_KEYS = ["id", "time", "write"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readProgress(value: unknown): TaskProgress | null {
  const direct = readNumber(value);
  if (direct !== null) {
    return { current: direct, max: null };
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const current = readNumber(record.current);
  return current === null ? null : { current, max: readNumber(record.max) };
}

function readKind(descriptor: Record<string, unknown>): string | null {
  const tagged = descriptor.type;
  if (typeof tagged === "string" && tagged.length > 0) {
    return tagged;
  }

  return (
    Object.keys(descriptor).find((key) => !DESCRIPTOR_KEYS.includes(key)) ?? null
  );
}

function readDetail(descriptor: Record<string, unknown>): string | null {
  const kind = asRecord(descriptor.kind)?.type;
  return typeof kind === "string" && kind.length > 0 ? kind : null;
}

function readTask(value: unknown): ServerTaskEntry | null {
  const descriptor = asRecord(value);
  if (!descriptor) {
    return null;
  }

  const kind = readKind(descriptor);
  if (kind === null) {
    return null;
  }

  return {
    id: readNumber(descriptor.id) ?? 0,
    time: readNumber(descriptor.time) ?? 0,
    write: descriptor.write === true,
    kind,
    detail: readDetail(descriptor),
    progress: readProgress(descriptor.progress),
  };
}

function readTasks(value: unknown): ServerTaskEntry[] {
  if (!Array.isArray(value)) {
    return NO_TASKS;
  }

  const tasks = value
    .map(readTask)
    .filter((task): task is ServerTaskEntry => task !== null);

  return tasks.length > 0 ? tasks : NO_TASKS;
}

export function readServerTasks(message: string): ServerTasksSnapshot | null {
  if (!message.startsWith(TASKS_MESSAGE_PREFIX)) {
    return null;
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = asRecord(JSON.parse(message.slice(TASKS_MESSAGE_PREFIX.length)));
  } catch {
    return null;
  }

  if (!payload) {
    return null;
  }

  return {
    storage: readTasks(payload.storage),
    server: readTasks(payload.server),
  };
}

function taskSignature(task: ServerTaskEntry): string {
  const progress = task.progress
    ? `${task.progress.current}/${task.progress.max ?? ""}`
    : "";

  return `${task.id}:${task.write}:${task.kind}:${task.detail ?? ""}:${progress}`;
}

function scopeSignature(tasks: ServerTaskEntry[]): string {
  return tasks.map(taskSignature).join(",");
}

function scopeTasks(
  previous: ServerTaskEntry[],
  next: ServerTaskEntry[],
): ServerTaskEntry[] {
  return scopeSignature(previous) === scopeSignature(next) ? previous : next;
}

/**
 * Keeps the previous entries of every scope that did not change, so that the
 * once-per-second task message only re-renders what it actually affects.
 */
export function mergeServerTasks(
  previous: ServerTasksSnapshot | undefined,
  next: ServerTasksSnapshot,
): ServerTasksSnapshot {
  if (!previous) {
    return next;
  }

  const storage = scopeTasks(previous.storage, next.storage);
  const server = scopeTasks(previous.server, next.server);

  return storage === previous.storage && server === previous.server
    ? previous
    : { storage, server };
}

/**
 * The daemon guarantees that a scope holds either any number of read tasks or a
 * single write task. A read action is therefore blocked by an active write
 * task, and a write action by any active task.
 */
export function taskLock(
  tasks: ServerTaskEntry[],
  access: TaskAccess,
): TaskLock {
  if (tasks.length === 0) {
    return UNLOCKED;
  }

  const writeTask = tasks.find((task) => task.write) ?? null;

  if (access === "read") {
    return writeTask === null
      ? { tasks, blocking: null, locked: false }
      : { tasks, blocking: writeTask, locked: true };
  }

  return { tasks, blocking: writeTask ?? tasks[0], locked: true };
}

export function taskLabel(task: ServerTaskEntry, t: TFunction): string {
  const detail = task.detail
    ? t(`servers:tasks.fileOperations.${task.detail}`, {
        defaultValue: task.detail,
      })
    : null;

  const label = t(`servers:tasks.kinds.${task.kind}`, {
    defaultValue: task.kind,
  });

  return detail ? `${label} (${detail})` : label;
}

export function taskProgressPercent(task: ServerTaskEntry): number | null {
  const progress = task.progress;

  if (!progress || progress.max === null || progress.max <= 0) {
    return null;
  }

  return Math.min(100, (progress.current / progress.max) * 100);
}
