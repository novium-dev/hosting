"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  CornerDownLeft,
  Download,
  ListFilter,
  MoreVertical,
  RotateCw,
  Search,
  Trash2,
  WrapText,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConsoleSocket } from "@/hooks/use-console-socket";
import {
  consoleLevels,
  consoleLineToText,
  formatLineTime,
  parseConsoleLine,
  splitChunk,
  systemConsoleLine,
  type ConsoleColor,
  type ConsoleLevel,
  type ConsoleLine,
  type ConsoleSegment,
} from "@/lib/console-log";
import { cn } from "@/lib/utils";
import { useConsolePreferences } from "@/stores/console-preferences";

const MAX_LINES = 10000;
const ROW_ESTIMATE = 22;
const OVERSCAN = 24;
const FLUSH_INTERVAL = 60;
const BOTTOM_THRESHOLD = 32;
const USER_SCROLL_WINDOW = 400;
const COMMAND_HISTORY_STORAGE_KEY = "console-command-history-v1";
const COMMAND_HISTORY_LIMIT = 25;
const COLLAPSIBLE_LINES = 2;
const AUTO_COLLAPSE_LINES = 4;

const LEVEL_TEXT: Record<ConsoleLevel, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
  debug: "text-sky-600 dark:text-sky-400",
  trace: "text-violet-600 dark:text-violet-400",
};

const LEVEL_LABEL: Record<ConsoleLevel, string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
  trace: "TRACE",
};

const ANSI_TEXT: Record<ConsoleColor, string> = {
  black: "text-neutral-700 dark:text-neutral-300",
  red: "text-red-600 dark:text-red-400",
  green: "text-emerald-600 dark:text-emerald-400",
  yellow: "text-amber-600 dark:text-amber-400",
  blue: "text-blue-600 dark:text-blue-400",
  magenta: "text-fuchsia-600 dark:text-fuchsia-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  white: "text-foreground/90",
  brightBlack: "text-muted-foreground",
  brightRed: "text-red-500 dark:text-red-300",
  brightGreen: "text-emerald-500 dark:text-emerald-300",
  brightYellow: "text-amber-500 dark:text-amber-300",
  brightBlue: "text-sky-500 dark:text-sky-300",
  brightMagenta: "text-fuchsia-500 dark:text-fuchsia-300",
  brightCyan: "text-cyan-500 dark:text-cyan-300",
  brightWhite: "text-foreground",
};

const MESSAGE_TEXT: Record<ConsoleLevel, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-foreground",
  info: "text-foreground/90",
  debug: "text-foreground/70",
  trace: "text-muted-foreground",
};

type ConsoleRow = {
  line: ConsoleLine;
  hiddenCount: number;
  collapsible: boolean;
  collapsed: boolean;
};

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];

  let cursor = 0;
  let found = haystack.indexOf(needle, cursor);

  while (found !== -1) {
    if (found > cursor) parts.push(text.slice(cursor, found));
    parts.push(
      <mark
        key={`${found}-${parts.length}`}
        className="rounded-[2px] bg-amber-400/35 text-inherit"
      >
        {text.slice(found, found + needle.length)}
      </mark>,
    );
    cursor = found + needle.length;
    found = haystack.indexOf(needle, cursor);
  }

  parts.push(text.slice(cursor));

  return <>{parts}</>;
}

function isPlainSegment(segment: ConsoleSegment) {
  return (
    segment.color === null &&
    !segment.bold &&
    !segment.dim &&
    !segment.italic &&
    !segment.underline
  );
}

function LineText({
  segments,
  query,
}: {
  segments: ConsoleSegment[];
  query: string;
}) {
  const only = segments.length === 1 ? segments[0] : null;

  if (only && isPlainSegment(only)) {
    return <Highlight text={only.text} query={query} />;
  }

  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={`${index}-${segment.text.length}`}
          className={cn(
            segment.color ? ANSI_TEXT[segment.color] : null,
            segment.bold && "font-semibold",
            segment.dim && "opacity-70",
            segment.italic && "italic",
            segment.underline && "underline",
          )}
        >
          <Highlight text={segment.text} query={query} />
        </span>
      ))}
    </>
  );
}

function loadCommandHistory() {
  try {
    const raw = localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, COMMAND_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export default function LogConsole({ serverId }: { serverId: string }) {
  const { t } = useTranslation();

  const {
    showTimestamps,
    showSource,
    wrapLines,
    hiddenLevels,
    toggleTimestamps,
    toggleSource,
    toggleWrapLines,
    toggleLevel,
    resetLevels,
  } = useConsolePreferences();

  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [anySource, setAnySource] = useState(false);
  const [filter, setFilter] = useState("");
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadCommandHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [groupOverrides, setGroupOverrides] = useState<Record<number, boolean>>(
    {},
  );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<ConsoleLine[]>([]);
  const partialRef = useRef("");
  const nextIdRef = useRef(0);
  const previousLineRef = useRef<ConsoleLine | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(true);
  const anySourceRef = useRef(false);
  const userScrollAtRef = useRef(0);
  const pointerDownRef = useRef(false);

  pinnedRef.current = pinnedToBottom;

  const flush = useCallback(() => {
    flushTimerRef.current = null;

    const pending = bufferRef.current;
    if (pending.length === 0) return;

    bufferRef.current = [];
    setLines((previous) => {
      const next = previous.concat(pending);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(flush, FLUSH_INTERVAL);
  }, [flush]);

  const pushSystemLine = useCallback(
    (message: string) => {
      const line = systemConsoleLine(
        nextIdRef.current++,
        message,
        previousLineRef.current,
      );
      previousLineRef.current = line;
      bufferRef.current.push(line);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const handleChunk = useCallback(
    (chunk: string) => {
      const { lines: parts, rest } = splitChunk(partialRef.current, chunk);
      partialRef.current = rest;

      for (const part of parts) {
        const line = parseConsoleLine(part, {
          id: nextIdRef.current++,
          previous: previousLineRef.current,
        });

        if (line.raw.length === 0 && part.trim().length > 0) continue;

        previousLineRef.current = line;
        bufferRef.current.push(line);

        if (line.source !== null && !anySourceRef.current) {
          anySourceRef.current = true;
          setAnySource(true);
        }
      }

      if (parts.length > 0) scheduleFlush();
    },
    [scheduleFlush],
  );

  const handleClose = useCallback(
    (willRetry: boolean) => {
      pushSystemLine(
        willRetry
          ? t("servers:console.system.reconnecting")
          : t("servers:console.system.disconnected"),
      );
    },
    [pushSystemLine, t],
  );

  const handleFail = useCallback(() => {
    pushSystemLine(t("servers:console.system.failed"));
  }, [pushSystemLine, t]);

  const { status, canWrite, send, reconnect } = useConsoleSocket({
    serverId,
    onChunk: handleChunk,
    onClose: handleClose,
    onFail: handleFail,
  });

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const counts = useMemo(() => {
    let errors = 0;
    let warns = 0;

    for (const line of lines) {
      if (line.level === "error") errors += 1;
      else if (line.level === "warn") warns += 1;
    }

    return { errors, warns };
  }, [lines]);

  const query = filter.trim();

  const visibleLines = useMemo(() => {
    const needle = query.toLowerCase();

    return lines.filter((line) => {
      if (!line.system && hiddenLevels.includes(line.level)) return false;
      if (!needle) return true;
      return line.raw.toLowerCase().includes(needle);
    });
  }, [lines, hiddenLevels, query]);

  // Stack traces arrive as continuation lines under the line that opened them.
  // Grouping them keeps a single trace from flooding the viewport: anything
  // past AUTO_COLLAPSE_LINES folds into its parent until it is opened.
  const rows = useMemo(() => {
    const counts = new Map<number, number>();
    let parentId: number | null = null;

    for (const line of visibleLines) {
      if (line.continuation && parentId !== null) {
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
        continue;
      }

      parentId = line.continuation ? null : line.id;
    }

    const result: ConsoleRow[] = [];
    let collapsedParent = false;

    parentId = null;

    for (const line of visibleLines) {
      if (line.continuation && parentId !== null) {
        if (!collapsedParent) {
          result.push({
            line,
            hiddenCount: 0,
            collapsible: false,
            collapsed: false,
          });
        }

        continue;
      }

      parentId = line.continuation ? null : line.id;

      const hiddenCount = parentId === null ? 0 : (counts.get(parentId) ?? 0);
      const override = parentId === null ? undefined : groupOverrides[parentId];
      const collapsible = hiddenCount >= COLLAPSIBLE_LINES;
      const collapsed =
        collapsible &&
        (override === undefined
          ? hiddenCount >= AUTO_COLLAPSE_LINES
          : !override);

      collapsedParent = collapsed;

      result.push({ line, hiddenCount, collapsible, collapsed });
    }

    return result;
  }, [visibleLines, groupOverrides]);

  const toggleGroup = useCallback(
    (id: number, expanded: boolean) => {
      setGroupOverrides((previous) => ({ ...previous, [id]: expanded }));
    },
    [],
  );

  const sourceColumn = showSource && anySource;

  // Lines carry the clock offset learned from the last timestamped line, so
  // rendering from the newest one keeps every fallback timestamp on the
  // server's clock instead of mixing it with the browser's.
  const clockOffset = lines[lines.length - 1]?.clockOffset ?? 0;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    getItemKey: (index) => rows[index]?.line.id ?? index,
  });

  const totalSize = virtualizer.getTotalSize();

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    viewport.scrollTop = viewport.scrollHeight;
  }, []);

  // Row heights change when the columns or wrapping change, so the cached
  // measurements have to be thrown away before the next paint.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, wrapLines, showTimestamps, sourceColumn]);

  // Rows are measured after they render, so the total size keeps moving while
  // output streams in; sticking to it rather than to the row count is what
  // keeps the viewport at the bottom.
  useEffect(() => {
    if (!pinnedRef.current) return;
    scrollToBottom();
  }, [
    rows,
    totalSize,
    wrapLines,
    showTimestamps,
    sourceColumn,
    scrollToBottom,
  ]);

  useEffect(() => {
    const release = () => {
      pointerDownRef.current = false;
    };

    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  // Only a deliberate scroll may detach the console. Content that grows faster
  // than the programmatic scroll can follow also fires scroll events, and
  // treating those as intent would leave the console stranded mid-stream.
  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const distance =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

    if (distance <= BOTTOM_THRESHOLD) {
      setPinnedToBottom(true);
      return;
    }

    if (
      pointerDownRef.current ||
      Date.now() - userScrollAtRef.current < USER_SCROLL_WINDOW
    ) {
      setPinnedToBottom(false);
    }
  }, []);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    userScrollAtRef.current = Date.now();

    if (event.deltaY < 0) {
      setPinnedToBottom(false);
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    userScrollAtRef.current = Date.now();
  }, []);

  const handlePointerDown = useCallback(() => {
    pointerDownRef.current = true;
    userScrollAtRef.current = Date.now();
  }, []);

  const clear = useCallback(() => {
    bufferRef.current = [];
    previousLineRef.current = null;
    anySourceRef.current = false;
    setAnySource(false);
    setGroupOverrides({});
    setLines([]);
  }, []);

  const copyVisible = useCallback(async () => {
    const text = visibleLines
      .map((line) => consoleLineToText(line, showTimestamps, clockOffset))
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        t("servers:console.copied", { count: visibleLines.length }),
      );
    } catch {
      toast.error(t("servers:console.copyFailed"));
    }
  }, [visibleLines, showTimestamps, clockOffset, t]);

  const download = useCallback(() => {
    const text = lines
      .map((line) => consoleLineToText(line, showTimestamps, clockOffset))
      .join("\n");

    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${serverId}-console.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [lines, showTimestamps, clockOffset, serverId]);

  const rememberCommand = useCallback((value: string) => {
    setHistory((previous) => {
      const next = [
        value,
        ...previous.filter((entry) => entry !== value),
      ].slice(0, COMMAND_HISTORY_LIMIT);

      try {
        localStorage.setItem(COMMAND_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage may be unavailable (private mode, quota).
      }

      return next;
    });
  }, []);

  const submitCommand = useCallback(() => {
    const value = command.trim();
    if (!value) return;

    if (!send(`${value}\n`)) {
      toast.error(t("servers:console.notConnected"));
      return;
    }

    rememberCommand(value);
    setCommand("");
    setHistoryIndex(-1);
    setPinnedToBottom(true);
    scrollToBottom();
  }, [command, send, rememberCommand, scrollToBottom, t]);

  const stepHistory = useCallback(
    (direction: 1 | -1) => {
      if (history.length === 0) return;

      const nextIndex = Math.min(
        history.length - 1,
        Math.max(-1, historyIndex + direction),
      );

      setHistoryIndex(nextIndex);
      setCommand(nextIndex === -1 ? "" : (history[nextIndex] ?? ""));
    },
    [history, historyIndex],
  );

  const isLive = status === "open" && pinnedToBottom;

  return (
    <Card className="gap-0 overflow-hidden border-border/60 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-1.5 rounded-full bg-red-500" />
            <span className={counts.errors > 0 ? "" : "text-muted-foreground"}>
              {t("servers:console.counts.errors", { count: counts.errors })}
            </span>
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className="size-1.5 rounded-full bg-amber-500" />
            <span className={counts.warns > 0 ? "" : "text-muted-foreground"}>
              {t("servers:console.counts.warns", { count: counts.warns })}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={showTimestamps ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={toggleTimestamps}
          >
            <Clock className="size-3.5" />
            {t("servers:console.toolbar.time")}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={hiddenLevels.length > 0 ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                title={t("servers:console.toolbar.levels")}
                aria-label={t("servers:console.toolbar.levels")}
              >
                <ListFilter className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>
                {t("servers:console.toolbar.levels")}
              </DropdownMenuLabel>
              {consoleLevels.map((level) => (
                <DropdownMenuCheckboxItem
                  key={level}
                  checked={!hiddenLevels.includes(level)}
                  onCheckedChange={() => toggleLevel(level)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className={LEVEL_TEXT[level]}>
                    {t(`servers:console.levels.${level}`)}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={hiddenLevels.length === 0}
                onSelect={() => resetLevels()}
              >
                {t("common:actions.reset")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={visibleLines.length === 0}
                aria-label={t("servers:console.toolbar.copy")}
                onClick={() => void copyVisible()}
              >
                <Copy className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("servers:console.toolbar.copy")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={lines.length === 0}
                aria-label={t("servers:console.toolbar.download")}
                onClick={download}
              >
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("servers:console.toolbar.download")}
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("servers:console.toolbar.more")}
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuCheckboxItem
                checked={showSource}
                onCheckedChange={toggleSource}
                onSelect={(event) => event.preventDefault()}
              >
                {t("servers:console.toolbar.source")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={wrapLines}
                onCheckedChange={toggleWrapLines}
                onSelect={(event) => event.preventDefault()}
              >
                <WrapText className="size-4" />
                {t("servers:console.toolbar.wrap")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => reconnect()}>
                <RotateCw className="size-4" />
                {t("servers:console.toolbar.reconnect")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={clear}>
                <Trash2 className="size-4" />
                {t("servers:console.toolbar.clear")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CardContent className="relative p-0">
        <div
          ref={viewportRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onPointerDown={handlePointerDown}
          className={cn(
            "h-[26rem] overflow-y-auto bg-muted/30 py-2 text-[13px] leading-relaxed sm:h-[32rem] dark:bg-black/30",
            wrapLines ? "overflow-x-hidden" : "overflow-x-auto",
          )}
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          {visibleLines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {status === "connecting"
                ? t("servers:console.connecting")
                : lines.length === 0
                  ? t("servers:console.empty")
                  : t("servers:console.noMatches")}
            </p>
          ) : (
            <div
              className="relative w-full"
              style={{
                height: totalSize,
                overflowAnchor: "none",
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;

                const line = row.line;

                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className={cn(
                      "absolute left-0 top-0 flex gap-3 px-4 py-px transition-colors hover:bg-foreground/[0.04]",
                      wrapLines ? "w-full" : "w-max min-w-full",
                    )}
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {sourceColumn && (
                      <span
                        className="w-24 shrink-0 truncate text-muted-foreground/70"
                        title={line.source ?? undefined}
                      >
                        {line.source ?? ""}
                      </span>
                    )}

                    <span
                      className={cn(
                        "w-12 shrink-0 text-[10px] font-semibold leading-6 tracking-wider",
                        LEVEL_TEXT[line.level],
                      )}
                    >
                      {line.continuation || line.system
                        ? ""
                        : LEVEL_LABEL[line.level]}
                    </span>

                    {showTimestamps && (
                      <span className="w-[4.75rem] shrink-0 tabular-nums text-muted-foreground/70">
                        {formatLineTime(line, clockOffset)}
                      </span>
                    )}

                    <span
                      className={cn(
                        "min-w-0 flex-1",
                        line.system
                          ? "italic text-muted-foreground"
                          : MESSAGE_TEXT[line.level],
                        wrapLines
                          ? "whitespace-pre-wrap break-words"
                          : "whitespace-pre",
                      )}
                    >
                      {row.collapsible && (
                        <button
                          type="button"
                          onClick={() => toggleGroup(line.id, row.collapsed)}
                          aria-expanded={!row.collapsed}
                          aria-label={t("servers:console.hiddenLines", {
                            count: row.hiddenCount,
                          })}
                          className="mr-2 inline-flex items-center gap-0.5 rounded border border-border/60 bg-foreground/5 px-1 align-middle text-[11px] leading-4 font-medium text-muted-foreground hover:bg-foreground/10"
                        >
                          {row.collapsed ? (
                            <ChevronRight className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          )}
                          {row.collapsed
                            ? t("servers:console.hiddenLines", {
                                count: row.hiddenCount,
                              })
                            : null}
                        </button>
                      )}
                      <LineText segments={line.segments} query={query} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!pinnedToBottom && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute bottom-4 left-1/2 h-8 -translate-x-1/2 gap-1.5 shadow-md"
            onClick={() => {
              setPinnedToBottom(true);
              scrollToBottom();
            }}
          >
            <ArrowDown className="size-3.5" />
            {t("servers:console.jumpToLatest")}
          </Button>
        )}
      </CardContent>

      <div className="flex items-center gap-3 border-t px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("servers:console.filterPlaceholder")}
            className="h-8 border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0 dark:bg-transparent"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {t("servers:console.lineCount", { count: visibleLines.length })}
        </span>

        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1.5 font-normal",
            isLive && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              status === "open"
                ? isLive
                  ? "animate-pulse bg-emerald-500"
                  : "bg-amber-500"
                : status === "connecting"
                  ? "animate-pulse bg-amber-500"
                  : "bg-muted-foreground",
            )}
          />
          {status === "open"
            ? isLive
              ? t("servers:console.live")
              : t("servers:console.paused")
            : t(`servers:console.status.${status}`)}
        </Badge>
      </div>

      {canWrite && (
        <form
          className="flex items-center gap-2 border-t px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitCommand();
          }}
        >
          <span
            className="pl-1 text-sm text-muted-foreground"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            &gt;
          </span>
          <Input
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                stepHistory(1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                stepHistory(-1);
              }
            }}
            placeholder={t("servers:console.commandPlaceholder")}
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={status !== "open"}
          />
          <Button
            type="submit"
            size="sm"
            className="h-8 gap-1.5"
            disabled={status !== "open" || command.trim().length === 0}
          >
            <CornerDownLeft className="size-3.5" />
            {t("servers:terminal.sendButton")}
          </Button>
        </form>
      )}
    </Card>
  );
}
