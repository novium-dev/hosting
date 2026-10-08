/* eslint-disable no-control-regex */

/**
 * Parsing helpers for the enhanced console.
 *
 * The daemon terminal websocket streams raw process output: ANSI escapes,
 * carriage returns, Minecraft section colours and whatever log layout the
 * server software happens to use. `parseConsoleLine` turns one such line into
 * the structured shape the custom console renders (source / level / time /
 * styled message), falling back to a plain info line when nothing matches.
 *
 * Colours are kept as palette names instead of CSS, so the renderer can map
 * them onto the panel theme and stay readable in light and dark mode.
 */

export const consoleLevels = [
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type ConsoleLevel = (typeof consoleLevels)[number];

export const consoleColors = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export type ConsoleColor = (typeof consoleColors)[number];

export type ConsoleStyle = {
  color: ConsoleColor | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

export type ConsoleSegment = ConsoleStyle & { text: string };

export type ConsoleLine = {
  id: number;
  raw: string;
  level: ConsoleLevel;
  timestamp: string | null;
  clockOffset: number;
  receivedAt: number;
  source: string | null;
  message: string;
  segments: ConsoleSegment[];
  continuation: boolean;
  system: boolean;
  command: boolean;
};

const ANSI_TOKEN_PATTERN =
  /\u001B\][\s\S]*?(?:\u0007|\u001B\\)|\u001B\[([0-?]*)[ -/]*([@-~])|\u001B[@-Z\\-_]/g;
const SECTION_COLOR_PATTERN = /\u00A7[0-9A-FK-ORa-fk-orXx]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const DEFAULT_STYLE: ConsoleStyle = {
  color: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

const BASE_COLORS: ConsoleColor[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

const BRIGHT_COLORS: ConsoleColor[] = [
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

const PALETTE_RGB: Record<ConsoleColor, [number, number, number]> = {
  black: [0, 0, 0],
  red: [205, 0, 0],
  green: [0, 205, 0],
  yellow: [205, 205, 0],
  blue: [0, 0, 238],
  magenta: [205, 0, 205],
  cyan: [0, 205, 205],
  white: [229, 229, 229],
  brightBlack: [127, 127, 127],
  brightRed: [255, 0, 0],
  brightGreen: [0, 255, 0],
  brightYellow: [255, 255, 0],
  brightBlue: [92, 92, 255],
  brightMagenta: [255, 0, 255],
  brightCyan: [0, 255, 255],
  brightWhite: [255, 255, 255],
};

const SECTION_COLORS: Record<string, ConsoleColor> = {
  "0": "black",
  "1": "blue",
  "2": "green",
  "3": "cyan",
  "4": "red",
  "5": "magenta",
  "6": "yellow",
  "7": "white",
  "8": "brightBlack",
  "9": "brightBlue",
  a: "brightGreen",
  b: "brightCyan",
  c: "brightRed",
  d: "brightMagenta",
  e: "brightYellow",
  f: "brightWhite",
};

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function nearestColor(red: number, green: number, blue: number) {
  let best: ConsoleColor = "white";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const color of consoleColors) {
    const [candidateRed, candidateGreen, candidateBlue] = PALETTE_RGB[color];
    const distance =
      (candidateRed - red) ** 2 +
      (candidateGreen - green) ** 2 +
      (candidateBlue - blue) ** 2;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }

  return best;
}

function indexedColor(value: number) {
  if (value < 8) return BASE_COLORS[value] ?? null;
  if (value < 16) return BRIGHT_COLORS[value - 8] ?? null;

  if (value < 232) {
    const offset = value - 16;

    return nearestColor(
      CUBE_LEVELS[Math.floor(offset / 36) % 6] ?? 0,
      CUBE_LEVELS[Math.floor(offset / 6) % 6] ?? 0,
      CUBE_LEVELS[offset % 6] ?? 0,
    );
  }

  const gray = Math.min(255, 8 + (value - 232) * 10);

  return nearestColor(gray, gray, gray);
}

function applySgr(style: ConsoleStyle, body: string): ConsoleStyle {
  const params = body
    .split(";")
    .map((part) => (part === "" ? 0 : Number.parseInt(part, 10)));

  const next = { ...style };

  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (code === undefined || Number.isNaN(code)) continue;

    if (code === 0) {
      Object.assign(next, DEFAULT_STYLE);
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 2) {
      next.dim = true;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) {
      next.italic = false;
    } else if (code === 24) {
      next.underline = false;
    } else if (code >= 30 && code <= 37) {
      next.color = BASE_COLORS[code - 30] ?? null;
    } else if (code >= 90 && code <= 97) {
      next.color = BRIGHT_COLORS[code - 90] ?? null;
    } else if (code === 39) {
      next.color = null;
    } else if (code === 38 || code === 48) {
      const mode = params[index + 1];

      if (mode === 5) {
        const value = params[index + 2];
        index += 2;

        if (code === 38 && value !== undefined && !Number.isNaN(value)) {
          next.color = indexedColor(value);
        }
      } else if (mode === 2) {
        const red = params[index + 2];
        const green = params[index + 3];
        const blue = params[index + 4];
        index += 4;

        if (
          code === 38 &&
          red !== undefined &&
          green !== undefined &&
          blue !== undefined
        ) {
          next.color = nearestColor(red, green, blue);
        }
      }
    }
  }

  return next;
}

function applySectionCode(style: ConsoleStyle, code: string): ConsoleStyle {
  const key = code.toLowerCase();

  if (key === "r") return { ...DEFAULT_STYLE };
  if (key === "l") return { ...style, bold: true };
  if (key === "o") return { ...style, italic: true };
  if (key === "n") return { ...style, underline: true };
  if (key === "k" || key === "m" || key === "x") return style;

  return { ...style, color: SECTION_COLORS[key] ?? style.color };
}

function sameStyle(left: ConsoleStyle, right: ConsoleStyle) {
  return (
    left.color === right.color &&
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline
  );
}

function pushText(
  segments: ConsoleSegment[],
  text: string,
  style: ConsoleStyle,
) {
  const clean = text.replace(CONTROL_PATTERN, "");
  if (clean.length === 0) return;

  const last = segments[segments.length - 1];

  if (last && sameStyle(last, style)) {
    last.text += clean;
    return;
  }

  segments.push({ ...style, text: clean });
}

function appendText(
  segments: ConsoleSegment[],
  text: string,
  style: ConsoleStyle,
) {
  let current = style;
  let cursor = 0;

  SECTION_COLOR_PATTERN.lastIndex = 0;

  let match = SECTION_COLOR_PATTERN.exec(text);

  while (match) {
    pushText(segments, text.slice(cursor, match.index), current);
    current = applySectionCode(current, match[0].slice(1));
    cursor = match.index + match[0].length;
    match = SECTION_COLOR_PATTERN.exec(text);
  }

  pushText(segments, text.slice(cursor), current);

  return current;
}

export function parseAnsi(input: string): ConsoleSegment[] {
  const segments: ConsoleSegment[] = [];

  let style = DEFAULT_STYLE;
  let cursor = 0;

  ANSI_TOKEN_PATTERN.lastIndex = 0;

  let match = ANSI_TOKEN_PATTERN.exec(input);

  while (match) {
    style = appendText(segments, input.slice(cursor, match.index), style);

    const final = match[2];
    const params = match[1] ?? "";

    if (final === "m") {
      style = applySgr(style, params);
    } else if (final === "K") {
      if (params === "1" || params === "2") segments.length = 0;
    } else if (final === "G" || final === "`") {
      if (params === "" || params === "0" || params === "1") {
        segments.length = 0;
      }
    }

    cursor = match.index + match[0].length;
    match = ANSI_TOKEN_PATTERN.exec(input);
  }

  appendText(segments, input.slice(cursor), style);

  return segments;
}

function segmentsToText(segments: ConsoleSegment[]) {
  return segments.map((segment) => segment.text).join("");
}

function trimTrailing(segments: ConsoleSegment[]) {
  const trimmed = segments.map((segment) => ({ ...segment }));

  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (!last) break;

    const text = last.text.replace(/\s+$/, "");

    if (text.length === 0) {
      trimmed.pop();
      continue;
    }

    last.text = text;
    break;
  }

  return trimmed;
}

function sliceSegments(segments: ConsoleSegment[], start: number) {
  if (start <= 0) return segments;

  const sliced: ConsoleSegment[] = [];
  let offset = 0;

  for (const segment of segments) {
    const end = offset + segment.text.length;

    if (end > start) {
      sliced.push(
        offset >= start
          ? segment
          : { ...segment, text: segment.text.slice(start - offset) },
      );
    }

    offset = end;
  }

  return sliced;
}

function stripPrompt(segments: ConsoleSegment[]) {
  const match = PROMPT_PATTERN.exec(segmentsToText(segments));
  return match?.[0] ? sliceSegments(segments, match[0].length) : segments;
}

function plainSegments(text: string): ConsoleSegment[] {
  return text.length === 0 ? [] : [{ ...DEFAULT_STYLE, text }];
}

function messageSegments(
  segments: ConsoleSegment[],
  raw: string,
  message: string,
) {
  if (!raw.endsWith(message)) return plainSegments(message);
  return sliceSegments(segments, raw.length - message.length);
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

const PROMPT_PATTERN = /^(?:\s*>[ \t]+)+|^(?:\s*>[ \t]*)+$/;

const CONTINUATION_PATTERN =
  /^(?:\s+at\s|\s*Caused by:|\s*Suppressed:|\s*\.{3}\s*\d+\s+more|\s{4,}\S)/;
const BARE_LEVEL_PATTERN = /\b(FATAL|SEVERE|ERROR|WARNING|WARN|DEBUG|TRACE)\b/;
const THREAD_PATTERN =
  /^\[(?<source>[^\]\s][^\]]{0,40})\]\s*:?\s?(?<rest>[\s\S]*)$/;

function cleanSource(source: string | undefined) {
  if (!source) return null;
  const trimmed = source.trim();
  return trimmed.length > 0 && trimmed.length <= 48 ? trimmed : null;
}

const DAY_MS = 86_400_000;
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2}):(\d{2})/;

function normalizeClock(value: string | undefined) {
  if (!value) return null;

  const match = CLOCK_PATTERN.exec(value.trim());
  if (!match) return null;

  return `${(match[1] ?? "").padStart(2, "0")}:${match[2]}:${match[3]}`;
}

function localMsOfDay(at: number) {
  const date = new Date(at);

  return (
    (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) * 1000
  );
}

function clockOffsetFor(clock: string, receivedAt: number) {
  const match = CLOCK_PATTERN.exec(clock);
  if (!match) return 0;

  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);

  const delta =
    (hours * 3600 + minutes * 60 + seconds) * 1000 - localMsOfDay(receivedAt);
  const wrapped = ((delta % DAY_MS) + DAY_MS) % DAY_MS;

  return wrapped > DAY_MS / 2 ? wrapped - DAY_MS : wrapped;
}

function formatClock(at: number, offset: number) {
  return new Date(at + offset).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Log timestamps are wall-clock strings without a zone, so a server in another
 * timezone would make the column jump between its clock and the browser's. The
 * offset measured on the last timestamped line is carried over to every line
 * that has none, keeping a single clock in the column.
 */
function timeFields(
  clock: string | null,
  receivedAt: number,
  previous: ConsoleLine | null,
) {
  const offset =
    clock === null
      ? (previous?.clockOffset ?? 0)
      : clockOffsetFor(clock, receivedAt);

  return { timestamp: clock, clockOffset: offset };
}

export function formatLineTime(line: ConsoleLine, offset = line.clockOffset) {
  return line.timestamp ?? formatClock(line.receivedAt, offset);
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
  const segments = trimTrailing(stripPrompt(parseAnsi(input)));
  const raw = segmentsToText(segments);

  const base = {
    id,
    raw,
    receivedAt,
    continuation: false,
    system: false,
    command: false,
  };

  if (raw.trim().length === 0) {
    return {
      ...base,
      ...timeFields(null, receivedAt, previous),
      level: "info",
      source: null,
      message: "",
      segments: [],
    };
  }

  if (previous && CONTINUATION_PATTERN.test(raw)) {
    return {
      ...base,
      ...timeFields(null, receivedAt, previous),
      level: previous.level,
      source: previous.source,
      message: raw,
      segments,
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
      ...timeFields(normalizeClock(groups.time), receivedAt, previous),
      level,
      source,
      message,
      segments: messageSegments(segments, raw, message),
    };
  }

  const bare = BARE_LEVEL_PATTERN.exec(raw);

  return {
    ...base,
    ...timeFields(null, receivedAt, previous),
    level: normalizeLevel(bare?.[1]) ?? "info",
    source: null,
    message: raw,
    segments,
  };
}

export function systemConsoleLine(
  id: number,
  message: string,
  previous: ConsoleLine | null = null,
): ConsoleLine {
  const receivedAt = Date.now();

  return {
    id,
    raw: message,
    ...timeFields(null, receivedAt, previous),
    level: "info",
    receivedAt,
    source: null,
    message,
    segments: plainSegments(message),
    continuation: false,
    system: true,
    command: false,
  };
}

/**
 * Locally echoed line for a command the user submitted. The daemon does not
 * send typed input back on the log stream (JLine repaints its prompt with a
 * bare carriage return, which the splitter drops), so the console would
 * otherwise only show the server's answer and never the question.
 */
export function commandConsoleLine(
  id: number,
  command: string,
  previous: ConsoleLine | null = null,
): ConsoleLine {
  const receivedAt = Date.now();
  const raw = `> ${command}`;

  return {
    id,
    raw,
    ...timeFields(null, receivedAt, previous),
    level: "info",
    receivedAt,
    source: null,
    message: command,
    segments: plainSegments(command),
    continuation: false,
    system: false,
    command: true,
  };
}

export function consoleLineToText(
  line: ConsoleLine,
  withTimestamp: boolean,
  offset = line.clockOffset,
) {
  if (!withTimestamp) return line.raw;
  return line.timestamp
    ? line.raw
    : `${formatLineTime(line, offset)} ${line.raw}`;
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
