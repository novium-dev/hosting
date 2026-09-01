import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { serverTerminal } from "@/lib/api";

// Shared transport for both console modes: resolves the signed daemon terminal
// URL, keeps the websocket alive and hands raw decoded chunks to the caller.

export type ConsoleSocketStatus = "connecting" | "open" | "closed" | "failed";

export type TerminalSize = {
  cols: number;
  rows: number;
};

const AUTO_RETRY_LIMIT = 3;
const AUTO_RETRY_BASE_DELAY = 2000;
const RESIZE_PREFIX = "DAEMON_TTY_RESIZE:";

type ConsoleSocketOptions = {
  serverId: string;
  onChunk: (chunk: string) => void;
  onOpen?: () => void;
  onClose?: (willRetry: boolean) => void;
  onFail?: () => void;
  getSize?: () => TerminalSize | null;
};

export function useConsoleSocket({
  serverId,
  onChunk,
  onOpen,
  onClose,
  onFail,
  getSize,
}: ConsoleSocketOptions) {
  const [status, setStatus] = useState<ConsoleSocketStatus>("connecting");
  const [canWrite, setCanWrite] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const autoRetriesRef = useRef(0);
  const handlersRef = useRef({ onChunk, onOpen, onClose, onFail, getSize });

  useLayoutEffect(() => {
    handlersRef.current = { onChunk, onOpen, onClose, onFail, getSize };
  }, [onChunk, onOpen, onClose, onFail, getSize]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    setStatus("connecting");

    const scheduleRetry = () => {
      if (autoRetriesRef.current >= AUTO_RETRY_LIMIT) return false;

      const delay = AUTO_RETRY_BASE_DELAY * 2 ** autoRetriesRef.current;
      autoRetriesRef.current += 1;
      retryTimer = setTimeout(() => setAttempt((value) => value + 1), delay);

      return true;
    };

    const connect = async () => {
      const size = handlersRef.current.getSize?.();
      const response = await serverTerminal({
        path: { server_id: serverId },
        query: size ? { cols: size.cols, rows: size.rows } : undefined,
      });
      if (disposed) return;

      let url = response.data;
      if (response.error || !url) {
        setStatus("failed");
        handlersRef.current.onFail?.();
        return;
      }

      try {
        setCanWrite(new URL(url).searchParams.get("write") === "true");
      } catch {
        setCanWrite(false);
      }

      // if zrl contian localhost:4000 use localhost:4001
      //if (url.includes("wss://localhost:4000")) {
      //  url = url.replace("wss://localhost:4000", "ws://localhost:4001");
      //}

      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      const decoder = new TextDecoder();

      socket.onopen = () => {
        if (disposed) return;
        autoRetriesRef.current = 0;
        setStatus("open");
        handlersRef.current.onOpen?.();
      };

      socket.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        setStatus("closed");
        handlersRef.current.onClose?.(scheduleRetry());
      };

      socket.onmessage = async (event) => {
        if (disposed) return;

        const data: unknown = event.data;

        try {
          if (typeof data === "string") {
            handlersRef.current.onChunk(data);
          } else if (data instanceof ArrayBuffer) {
            handlersRef.current.onChunk(decoder.decode(data, { stream: true }));
          } else if (ArrayBuffer.isView(data)) {
            handlersRef.current.onChunk(decoder.decode(data, { stream: true }));
          } else if (data instanceof Blob) {
            const buffer = await data.arrayBuffer();
            if (!disposed) {
              handlersRef.current.onChunk(
                decoder.decode(buffer, { stream: true }),
              );
            }
          }
        } catch {
          // A single undecodable frame should not tear down the console.
        }
      };
    };

    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [serverId, attempt]);

  const send = useCallback((data: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    socket.send(data);
    return true;
  }, []);

  const sendResize = useCallback(
    (size: TerminalSize) => send(`${RESIZE_PREFIX}${size.cols}:${size.rows}`),
    [send],
  );

  const reconnect = useCallback(() => {
    autoRetriesRef.current = 0;
    setAttempt((value) => value + 1);
  }, []);

  return { status, canWrite, send, sendResize, reconnect };
}
