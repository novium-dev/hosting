import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { AppSession } from "@/lib/auth";
import { useSessionStore } from "@/stores/session";

type SessionContextValue = {
  session: AppSession | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined,
);

// Fetches the current user exactly once and shares it with the whole tree via
// context. The value is backed by the Zustand session store so logout can clear
// it imperatively.
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useSessionStore((state) => state.session);
  const status = useSessionStore((state) => state.status);
  const fetchSession = useSessionStore((state) => state.fetchSession);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isLoading: status === "idle" || status === "loading",
      refresh: () => fetchSession(true),
    }),
    [session, status, fetchSession],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return {
    data: context.session,
    isLoading: context.isLoading,
    refresh: context.refresh,
  };
}
