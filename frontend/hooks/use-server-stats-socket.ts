import { useEffect, useLayoutEffect, useRef } from "react";

import { serverStats } from "@/lib/api";

// Shared transport for a server's stats websocket: resolves the signed daemon
// URL, hands text frames to the caller and optionally reconnects when the
// connection drops.

const RECONNECT_DELAY = 5000;

export type StatsSocketFailure = "request" | "invalid-url";

type ServerStatsSocketOptions = {
  serverId: string;
  reconnect?: boolean;
  onConnect?: () => void;
  onMessage: (message: string) => void;
  onDisconnect?: () => void;
  onConnectFailed?: (failure: StatsSocketFailure) => void;
};

export function useServerStatsSocket({
  serverId,
  reconnect = false,
  onConnect,
  onMessage,
  onDisconnect,
  onConnectFailed,
}: ServerStatsSocketOptions) {
  const handlersRef = useRef({
    onConnect,
    onMessage,
    onDisconnect,
    onConnectFailed,
  });

  useLayoutEffect(() => {
    handlersRef.current = {
      onConnect,
      onMessage,
      onDisconnect,
      onConnectFailed,
    };
  }, [onConnect, onMessage, onDisconnect, onConnectFailed]);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      if (reconnect) {
        retryTimer = setTimeout(() => void connect(), RECONNECT_DELAY);
      }
    };

    const fail = (failure: StatsSocketFailure) => {
      handlersRef.current.onConnectFailed?.(failure);
      scheduleReconnect();
    };

    const connect = async () => {
      try {
        const response = await serverStats({ path: { server_id: serverId } });

        if (!mounted) {
          return;
        }

        if (response.error || !response.data) {
          fail(response.error ? "request" : "invalid-url");
          return;
        }

        socket = new WebSocket(response.data);
        socket.binaryType = "arraybuffer";
        socket.onopen = () => {
          if (mounted) {
            handlersRef.current.onConnect?.();
          }
        };
        socket.onerror = () => {
          if (mounted) {
            handlersRef.current.onDisconnect?.();
          }
        };
        socket.onclose = () => {
          if (mounted) {
            handlersRef.current.onDisconnect?.();
            scheduleReconnect();
          }
        };
        socket.onmessage = (event) => {
          if (mounted && typeof event.data === "string") {
            handlersRef.current.onMessage(event.data);
          }
        };
      } catch {
        if (mounted) {
          fail("request");
        }
      }
    };

    void connect();

    return () => {
      mounted = false;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [serverId, reconnect]);
}
