"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ITerminalInitOnlyOptions,
  ITerminalOptions,
  Terminal,
} from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";

import "@xterm/xterm/css/xterm.css";
import { serverTerminal } from "@/lib/api";

type ServerConsoleProps = {
  serverId: string;
};

const COMMAND_HISTORY_STORAGE_KEY = "console-command-history-v1";
const COMMAND_HISTORY_LIMIT = 20;

export default function ServerConsole({ serverId }: ServerConsoleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const { resolvedTheme } = useTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

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

    const cleanup = () => {
      wsRef.current?.close();
      wsRef.current = null;

      const terminal = terminalRef.current as
        | (Terminal & { dispose?: () => void })
        | null;
      terminal?.dispose?.();
      terminalRef.current = null;
    };

    const boot = async () => {
      try {
        if (!mounted || !containerRef.current) {
          return;
        }
        const options: ITerminalOptions & ITerminalInitOnlyOptions = {
          allowTransparency: true,
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
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();
        terminalRef.current = term;

        const handleResize = () => fitAddon.fit();
        window.addEventListener("resize", handleResize);

        const terminalUrl = await serverTerminal({ path: { server_id: serverId } });

        if (terminalUrl.error) {
          setError("Failed to connect to terminal session.");
          writeLine("Failed to connect to terminal session.");
          setIsLoading(false);
          return;
        }

        const socketUrl = terminalUrl.data

        if (!socketUrl) {
          setError("Failed to create terminal session.");
          writeLine("Failed to connect to terminal session.");
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
          setError("Terminal websocket connection failed.");
          setIsLoading(false);
        };

        socket.onclose = () => {
          if (!mounted) {
            return;
          }

          writeLine("[terminal disconnected]");
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
            setError("Failed to render terminal output.");
          }
        });
      } catch {
        setError("Failed to initialize terminal.");
        setIsLoading(false);
      }
    };

    void boot();

    return () => {
      mounted = false;

      cleanup();
    };
  }, [serverId, resolvedTheme, writeLine]);

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
        setError("Terminal is not connected.");
        return;
      }

      //_, err := e.stream.Conn.Write([]byte(c + "\n"))
      socket.send(`${command}\n`);
      updateCommandHistory(command);
      setCommandInput("");
      setError(null);
    },
    [updateCommandHistory],
  );

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Console</CardTitle>
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
                Connecting terminal...
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
            placeholder="Enter command (e.g. stop, say hello)"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="normal-case"
          />
          <Button type="submit" disabled={!canSendCommand}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
