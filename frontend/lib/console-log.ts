/* eslint-disable no-control-regex */

/**
 * Parsing helpers for the enhanced console.
 *
 * The daemon terminal websocket streams raw process output: ANSI escapes,
 * carriage returns, Minecraft section colours and whatever log layout the
 * server software happens to use. `parseConsoleLine` turns one such line into
 * the structured shape the custom console renders (source / level / time /
 * message), falling back to a plain info line when nothing matches.
 */

export const consoleLevels = [
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type ConsoleLevel = (typeof consoleLevels)[number];

export type ConsoleLine = {
  id: number;
  raw: string;
  level: ConsoleLevel;
  timestamp: string | null;
  receivedAt: number;
  source: string | null;
  message: string;
  continuation: boolean;
  system: boolean;
};

const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const SECTION_COLOR_PATTERN = /\u00A7[0-9A-FK-ORa-fk-orXx]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripAnsi(value: string) {
  return value
    .replace(ANSI_PATTERN, "")
    .replace(SECTION_COLOR_PATTERN, "")
    .replace(CONTROL_PATTERN, "");
}

const LEVEL_ALIASES: Record<string, ConsoleLevel> = {
  fatal: "error",
  severe: "error",
  critical: "error",
  crit: "error",
  error: "error",
  err: "error",
  warn: "warn",
  warning: "warn",
  info: "info",
  information: "info",
  notice: "info",
  life: "info",
  debug: "debug",
  fine: "debug",
  config: "debug",
  trace: "trace",
  finer: "trace",
  finest: "trace",
  verbose: "trace",
};

function normalizeLevel(token: string | undefined): ConsoleLevel | null {
  if (!token) return null;
  return LEVEL_ALIASES[token.toLowerCase()] ?? null;
}

const TIME = String.raw`\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?`;
const DATE = String.raw`\d{4}[-/]\d{2}[-/]\d{2}`;
const WORD = String.raw`[A-Za-z]{3,11}`;

const PATTERNS: RegExp[] = [
  // [12:26:32] [Server thread/INFO]: message   (vanilla, paper, forge)
  new RegExp(
    String.raw`^\[(?<time>${TIME})\]\s*\[(?<source>[^\]]*?)[/|](?<level>${WORD})\]\s*:?\s?(?<rest>[\s\S]*)$`,
  ),
  // [12:26:32] [INFO]: message
  new RegExp(
    String.raw`^\[(?<time>${TIME})\]\s*\[(?<level>${WORD})\]\s*:?\s?(?<rest>[\s\S]*)$`,
  ),
  // [12:26:32 INFO]: message   (bungee, older bukkit)
  new RegExp(
    String.raw`^\[(?<time>${TIME})\s+(?<level>${WORD})\]\s*:?\s?(?<rest>[\s\S]*)$`,
  ),
  // 12:26:32.123 [main] ERROR logger.name - message   (logback default)
  new RegExp(
    String.raw`^(?<time>${TIME})\s+\[(?<source>[^\]]+)\]\s+(?<level>${WORD})\s+(?<rest>[\s\S]*)$`,
  ),
  // 2026-08-29 12:26:32,123 ERROR [logger] message   (log4j)
  new RegExp(
    String.raw`^(?:${DATE}[ T])?(?<time>${TIME})Z?\s+(?<level>${WORD})\s*:?\s+(?<rest>[\s\S]*)$`,
  ),
  // ERROR: message   /   ERROR message
  new RegExp(String.raw`^(?<level>${WORD})\s*:?\s+(?<rest>[\s\S]*)$`),
];

const CONTINUATION_PATTERN =
  /^(?:\s+at\s|\s*Caused by:|\s*Suppressed:|\s*\.{3}\s*\d+\s+more|\s{4,}\S)/;
const BARE_LEVEL_PATTERN = /\b(FATAL|SEVERE|ERROR|WARNING|WARN|DEBUG|TRACE)\b/;
const THREAD_PATTERN = /^\[(?<source>[^\]\s][^\]]{0,40})\]\s*:?\s?(?<rest>[\s\S]*)$/;

function cleanSource(source: string | undefined) {
  if (!source) return null;
  const trimmed = source.trim();
  return trimmed.length > 0 && trimmed.length <= 48 ? trimmed : null;
}

export type ParseOptions = {
  id: number;
  receivedAt?: number;
  previous?: ConsoleLine | null;
};

export function parseConsoleLine(
  input: string,
  { id, receivedAt = Date.now(), previous = null }: ParseOptions,
): ConsoleLine {
  const raw = stripAnsi(input).replace(/\s+$/, "");

  const base = {
    id,
    raw,
    receivedAt,
    continuation: false,
    system: false,
  };

  if (raw.trim().length === 0) {
    return { ...base, level: "info", timestamp: null, source: null, message: "" };
  }

  if (previous && CONTINUATION_PATTERN.test(raw)) {
    return {
      ...base,
      level: previous.level,
      timestamp: null,
      source: previous.source,
      message: raw,
      continuation: true,
    };
  }

  for (const pattern of PATTERNS) {
    const match = pattern.exec(raw);
    const groups = match?.groups;
    if (!groups) continue;

    const level = normalizeLevel(groups.level);
    if (!level) continue;

    let source = cleanSource(groups.source);
    let message = groups.rest ?? "";

    if (!source) {
      const thread = THREAD_PATTERN.exec(message);
      if (thread?.groups && !thread.groups.source.includes(" ")) {
        source = cleanSource(thread.groups.source);
        message = thread.groups.rest;
      }
    }

    return {
      ...base,
      level,
      timestamp: groups.time ?? null,
      source,
      message,
    };
  }

  const bare = BARE_LEVEL_PATTERN.exec(raw);

  return {
    ...base,
    level: normalizeLevel(bare?.[1]) ?? "info",
    timestamp: null,
    source: null,
    message: raw,
  };
}

export function systemConsoleLine(id: number, message: string): ConsoleLine {
  return {
    id,
    raw: message,
    level: "info",
    timestamp: null,
    receivedAt: Date.now(),
    source: null,
    message,
    continuation: false,
    system: true,
  };
}

export function formatLineTime(line: ConsoleLine) {
  if (line.timestamp) return line.timestamp;

  return new Date(line.receivedAt).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function consoleLineToText(line: ConsoleLine, withTimestamp: boolean) {
  if (!withTimestamp) return line.raw;
  return line.timestamp ? line.raw : `${formatLineTime(line)} ${line.raw}`;
}

/**
 * Splits an incoming websocket chunk into complete lines, returning the
 * trailing partial line so it can be prepended to the next chunk.
 *
 * A lone carriage return is a cursor return, not a line break: line editors
 * such as JLine (which the Minecraft server console uses) repaint their `> `
 * prompt with one, and progress bars overwrite themselves the same way.
 * Treating those as newlines would emit a phantom line per repaint, so a bare
 * `\r` discards the partial line instead. Only CRLF and LF end a line.
 */
export function splitChunk(pending: string, chunk: string) {
  const buffer = pending + chunk;
  const lines: string[] = [];

  let current = "";

  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];

    if (char === "\n") {
      lines.push(current);
      current = "";
      continue;
    }

    if (char === "\r") {
      if (index === buffer.length - 1) {
        return { lines, rest: `${current}\r` };
      }

      if (buffer[index + 1] === "\n") {
        lines.push(current);
        current = "";
        index += 1;
        continue;
      }

      current = "";
      continue;
    }

    current += char;
  }

  return { lines, rest: current };
}
