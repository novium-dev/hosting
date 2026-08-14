"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ITerminalInitOnlyOptions,
  ITerminalOptions,
  Terminal,
} from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";

import "@xterm/xterm/css/xterm.css";
import { serverTerminal } from "@/lib/api";

type ServerConsoleProps = {
  serverId: string;
};

type SearchResults = {
  resultIndex: number;
  resultCount: number;
};

const COMMAND_HISTORY_STORAGE_KEY = "console-command-history-v1";
const COMMAND_HISTORY_LIMIT = 20;

export default function ServerConsole({ serverId }: ServerConsoleProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { resolvedTheme } = useTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
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

  const writeLine = useCallback((text: string) => {
    terminalRef.current?.write(`${text}\r\n`);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMMAND_HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const cleaned = parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, COMMAND_HISTORY_LIMIT);

      setCommandHistory(cleaned);
    } catch {
      // Ignore invalid local storage values.
    }
  }, []);

  const updateCommandHistory = useCallback((nextCommand: string) => {
    setCommandHistory((prev) => {
      const normalized = nextCommand.trim();
      if (!normalized) {
        return prev;
      }

      const next = [
        normalized,
        ...prev.filter((entry) => entry !== normalized),
      ].slice(0, COMMAND_HISTORY_LIMIT);

      try {
        localStorage.setItem(COMMAND_HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures (private mode/quota).
      }

      return next;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    let removeResizeListener: (() => void) | null = null;

    setSearchQuery("");
    setSearchResults({ resultIndex: -1, resultCount: 0 });

    const cleanup = () => {
      wsRef.current?.close();
      wsRef.current = null;

      removeResizeListener?.();
      removeResizeListener = null;

      const terminal = terminalRef.current as
        | (Terminal & { dispose?: () => void })
        | null;
      terminal?.dispose?.();
      terminalRef.current = null;
      searchAddonRef.current = null;
    };

    const boot = async () => {
      try {
        if (!mounted || !containerRef.current) {
          return;
        }
        const options: ITerminalOptions & ITerminalInitOnlyOptions = {
          allowTransparency: true,
          lineHeight: 1.2,
          disableStdin: true,
          convertEol: true,
          smoothScrollDuration: 0,
          allowProposedApi: true,
          fontWeightBold: "500",
          rescaleOverlappingGlyphs: true,

          fontFamily: "JetBrains Mono, monospace",
          fontSize: 14,
          theme: {
            background:
              resolvedTheme === "dark" ? "hsl(220 43% 4%)" : "hsl(220 43% 96%)",
            foreground: resolvedTheme === "dark" ? "hsl(220 43% 96%)" : "#333",
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
          },
        };
        const term = new Terminal(options);
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(searchAddon);
        term.loadAddon(new Unicode11Addon());
        term.loadAddon(new WebLinksAddon());
        term.unicode.activeVersion = "11";

        term.open(containerRef.current);
        fitAddon.fit();
        terminalRef.current = term;
        searchAddonRef.current = searchAddon;

        searchAddon.onDidChangeResults((results) => {
          if (!mounted) {
            return;
          }

          setSearchResults(results);
        });

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

        const handleResize = () => fitAddon.fit();
        window.addEventListener("resize", handleResize);
        removeResizeListener = () => {
          window.removeEventListener("resize", handleResize);
        };

        const terminalUrl = await serverTerminal({
          path: { server_id: serverId },
        });

        if (terminalUrl.error) {
          setError(t("servers:terminal.errors.connectFailed"));
          writeLine(t("servers:terminal.errors.connectFailed"));
          setIsLoading(false);
          return;
        }

        const socketUrl = terminalUrl.data;

        if (!socketUrl) {
          setError(t("servers:terminal.errors.createFailed"));
          writeLine(t("servers:terminal.errors.connectFailed"));
          setIsLoading(false);
          return;
        }

        console.log("Connecting to terminal websocket at:", socketUrl);

        const socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";
        wsRef.current = socket;
        const decoder = new TextDecoder();

        socket.onopen = () => {
          setIsLoading(false);
        };

        socket.onerror = () => {
          setError(t("servers:terminal.errors.socketFailed"));
          setIsLoading(false);
        };

        socket.onclose = () => {
          if (!mounted) {
            return;
          }

          writeLine(t("servers:terminal.errors.disconnected"));
        };

        socket.addEventListener("message", async (event) => {
          const data = event.data;

          if (typeof data === "string") {
            term.write(data);
            return;
          }

          try {
            if (data instanceof ArrayBuffer) {
              term.write(decoder.decode(data, { stream: true }));
              return;
            }

            if (ArrayBuffer.isView(data)) {
              term.write(decoder.decode(data, { stream: true }));
              return;
            }

            if (data instanceof Blob) {
              term.write(
                decoder.decode(await data.arrayBuffer(), { stream: true }),
              );
            }
          } catch {
            setError(t("servers:terminal.errors.renderFailed"));
          }
        });
      } catch (error) {
        console.error("Failed to initialize terminal:", error);
        setError(t("servers:terminal.errors.initFailed"));
        setIsLoading(false);
      }
    };

    void boot();

    return () => {
      mounted = false;

      cleanup();
    };
  }, [serverId, resolvedTheme, writeLine, t]);

  const canSendCommand =
    commandInput.trim().length > 0 &&
    wsRef.current?.readyState === WebSocket.OPEN;

  const sendCommand = useCallback(
    (rawCommand: string) => {
      const command = rawCommand.trim();
      if (!command) {
        return;
      }

      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setError(t("servers:terminal.errors.notConnected"));
        return;
      }

      socket.send(`${command}\n`);
      updateCommandHistory(command);
      setCommandInput("");
      setError(null);
    },
    [updateCommandHistory, t],
  );

  const runSearch = useCallback(
    (query: string, direction: "next" | "previous", incremental = false) => {
      const addon = searchAddonRef.current;
      if (!addon) {
        return;
      }

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
          <CardTitle className="text-lg">
            {t("servers:terminal.title")}
          </CardTitle>

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
                    runSearch(
                      searchQuery,
                      event.shiftKey ? "previous" : "next",
                    );
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
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="min-h-70 sm:min-h-95 p-3 sm:p-4 font-mono overflow-hidden rounded-md border dark:bg-black/50 bg-white/50">
            <div className="h-full w-full">
              <div ref={containerRef} className="h-full w-full" />
            </div>
          </div>

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/70">
              <div className="inline-flex items-center gap-2 text-sm text-white">
                <Loader2 className="size-4 animate-spin" />
                {t("servers:terminal.connecting")}
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            sendCommand(commandInput);
          }}
        >
          <Input
            value={commandInput}
            onChange={(event) => setCommandInput(event.target.value)}
            placeholder={t("servers:terminal.commandPlaceholder")}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="normal-case"
          />
          <Button type="submit" disabled={!canSendCommand}>
            {t("servers:terminal.sendButton")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
