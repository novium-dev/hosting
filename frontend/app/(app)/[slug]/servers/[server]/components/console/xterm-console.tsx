"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ITerminalInitOnlyOptions,
  type ITerminalOptions,
  type ITheme,
  Terminal,
} from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { useConsoleSocket } from "@/hooks/use-console-socket";
import { cn } from "@/lib/utils";

import "@xterm/xterm/css/xterm.css";

type SearchResults = {
  resultIndex: number;
  resultCount: number;
};

const DARK_THEME: ITheme = {
  background: "hsl(220 43% 4%)",
  foreground: "hsl(220 43% 96%)",
  cursor: "#C3E88D",
  red: "#E54B4B",
  green: "#9ECE58",
  yellow: "#FAED70",
  blue: "#396FE2",
  magenta: "#BB80B3",
  cyan: "#2DDAFD",
  white: "#d0d0d0",
  brightBlack: "rgba(255, 255, 255, 0.2)",
  brightRed: "#FF5370",
  brightGreen: "#C3E88D",
  brightYellow: "#FFCB6B",
  brightBlue: "#82AAFF",
  brightMagenta: "#C792EA",
  brightCyan: "#89DDFF",
  brightWhite: "#ffffff",
};

const LIGHT_THEME: ITheme = {
  ...DARK_THEME,
  background: "hsl(220 43% 96%)",
  foreground: "#333",
  cursor: "#2f7d32",
  brightBlack: "rgba(0, 0, 0, 0.3)",
};

export default function XtermConsole({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<string[]>([]);
  const sendRef = useRef<(data: string) => boolean>(() => false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults>({
    resultIndex: -1,
    resultCount: 0,
  });

  const searchOptions = useMemo<ISearchOptions>(
    () => ({
      decorations:
        resolvedTheme === "dark"
          ? {
              matchBackground: "#4a3f1a",
              matchBorder: "#ffcb6b",
              matchOverviewRuler: "#ffcb6b",
              activeMatchBackground: "#8a6e1e",
              activeMatchBorder: "#ffcb6b",
              activeMatchColorOverviewRuler: "#ffcb6b",
            }
          : {
              matchBackground: "#ffe9a8",
              matchBorder: "#c79a2b",
              matchOverviewRuler: "#c79a2b",
              activeMatchBackground: "#ffc94d",
              activeMatchBorder: "#c79a2b",
              activeMatchColorOverviewRuler: "#c79a2b",
            },
    }),
    [resolvedTheme],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const options: ITerminalOptions & ITerminalInitOnlyOptions = {
      allowTransparency: true,
      lineHeight: 1.2,
      disableStdin: true,
      convertEol: true,
      smoothScrollDuration: 0,
      allowProposedApi: true,
      fontWeightBold: "500",
      rescaleOverlappingGlyphs: true,
      cursorBlink: true,
      scrollback: 10000,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 14,
      theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
    };

    const term = new Terminal(options);
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(new WebLinksAddon());
    term.unicode.activeVersion = "11";

    term.open(container);
    fitAddon.fit();

    terminalRef.current = term;
    searchAddonRef.current = searchAddon;

    for (const chunk of pendingRef.current) term.write(chunk);
    pendingRef.current = [];

    const dataListener = term.onData((data) => sendRef.current(data));

    const resultsListener = searchAddon.onDidChangeResults(setSearchResults);

    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return false;
      }

      return true;
    });

    const panel = panelRef.current;
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // The panel can be measured while hidden; ignore.
      }
    });
    if (panel) observer.observe(panel);

    return () => {
      observer.disconnect();
      dataListener.dispose();
      resultsListener.dispose();
      searchAddonRef.current = null;
      terminalRef.current = null;
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;

    term.options.theme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;
  }, [resolvedTheme]);

  const handleChunk = useCallback((chunk: string) => {
    const term = terminalRef.current;
    if (!term) {
      pendingRef.current.push(chunk);
      return;
    }

    term.write(chunk);
  }, []);

  const handleClose = useCallback(
    (willRetry: boolean) => {
      terminalRef.current?.write(
        `\r\n\x1b[90m${
          willRetry
            ? t("servers:console.system.reconnecting")
            : t("servers:console.system.disconnected")
        }\x1b[0m\r\n`,
      );
    },
    [t],
  );

  const handleFail = useCallback(() => {
    terminalRef.current?.write(
      `\r\n\x1b[31m${t("servers:console.system.failed")}\x1b[0m\r\n`,
    );
  }, [t]);

  const { status, canWrite, send, reconnect } = useConsoleSocket({
    serverId,
    onChunk: handleChunk,
    onClose: handleClose,
    onFail: handleFail,
  });

  sendRef.current = send;

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;

    const writable = canWrite && status === "open";
    term.options.disableStdin = !writable;
    term.options.cursorBlink = writable;

    if (writable) term.focus();
  }, [canWrite, status]);

  const runSearch = useCallback(
    (query: string, direction: "next" | "previous", incremental = false) => {
      const addon = searchAddonRef.current;
      if (!addon) return;

      if (!query) {
        addon.clearDecorations();
        setSearchResults({ resultIndex: -1, resultCount: 0 });
        return;
      }

      if (direction === "previous") {
        addon.findPrevious(query, searchOptions);
        return;
      }

      addon.findNext(query, { ...searchOptions, incremental });
    },
    [searchOptions],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    searchAddonRef.current?.clearDecorations();
    setSearchResults({ resultIndex: -1, resultCount: 0 });
  }, []);

  const searchStatus = !searchQuery
    ? null
    : searchResults.resultCount === 0
      ? t("servers:terminal.search.noResults")
      : t("servers:terminal.search.results", {
          index: searchResults.resultIndex + 1,
          count: searchResults.resultCount,
        });

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">
              {t("servers:terminal.title")}
            </CardTitle>
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 font-normal",
                status === "open" &&
                  "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status === "open"
                    ? "bg-emerald-500"
                    : status === "connecting"
                      ? "animate-pulse bg-amber-500"
                      : "bg-muted-foreground",
                )}
              />
              {status === "open"
                ? t("servers:console.live")
                : t(`servers:console.status.${status}`)}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setSearchQuery(nextQuery);
                  runSearch(nextQuery, "next", true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runSearch(searchQuery, event.shiftKey ? "previous" : "next");
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    clearSearch();
                    terminalRef.current?.focus();
                  }
                }}
                onBlur={() => searchAddonRef.current?.clearActiveDecoration()}
                placeholder={t("servers:terminal.search.placeholder")}
                className="h-8 w-40 pl-7 sm:w-56"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
              {searchStatus}
            </span>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              disabled={!searchQuery}
              aria-label={t("servers:terminal.search.previous")}
              onClick={() => runSearch(searchQuery, "previous")}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              disabled={!searchQuery}
              aria-label={t("servers:terminal.search.next")}
              onClick={() => runSearch(searchQuery, "next")}
            >
              <ChevronDown className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={!searchQuery}
              aria-label={t("servers:terminal.search.clear")}
              onClick={clearSearch}
            >
              <X className="size-4" />
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("servers:console.toolbar.reconnect")}
                  onClick={reconnect}
                >
                  <RotateCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("servers:console.toolbar.reconnect")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div
            ref={panelRef}
            className="h-[26rem] overflow-hidden rounded-md border bg-white/50 p-3 font-mono sm:h-[32rem] sm:p-4 dark:bg-black/50"
            onClick={() => terminalRef.current?.focus()}
          >
            <div className="h-full w-full">
              <div ref={containerRef} className="h-full w-full" />
            </div>
          </div>

          {status === "connecting" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/70">
              <div className="inline-flex items-center gap-2 text-sm text-white">
                <Loader2 className="size-4 animate-spin" />
                {t("servers:terminal.connecting")}
              </div>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {canWrite
            ? t("servers:terminal.typeHint")
            : t("servers:terminal.readOnlyHint")}
        </p>
      </CardContent>
    </Card>
  );
}
