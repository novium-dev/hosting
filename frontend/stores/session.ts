import { create } from "zustand";
import { me } from "@/lib/api";
import type { MeResponse } from "@/lib/api";
import type { AppSession } from "@/lib/auth";

// Global session cache. The current user is fetched once (via SessionProvider)
// and read everywhere through `useSession()`. Imperative code (logout) can clear
// it without a React context, which is why the source of truth is a store.

type Status = "idle" | "loading" | "authenticated" | "unauthenticated";

type SessionState = {
  session: AppSession | null;
  status: Status;
  /** Fetch the session once; pass `force` to refetch on demand. */
  fetchSession: (force?: boolean) => Promise<void>;
  setSession: (session: AppSession | null) => void;
  clear: () => void;
};

function toSession(user: MeResponse): AppSession {
  return {
    user: {
      id: String(user.id),
      name: user.username,
      email: user.email,
      image: null,
      permissions: user.permissions,
      role: user.role.toLowerCase() as AppSession["user"]["role"],
    },
    session: {
      id: String(user.id),
      token: "",
      userId: String(user.id),
    },
  };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  status: "idle",
  fetchSession: async (force = false) => {
    if (!force && get().status !== "idle") return;
    set({ status: "loading" });

    const response = await me();
    if (response.error || !response.data) {
      set({ session: null, status: "unauthenticated" });
      return;
    }

    set({ session: toSession(response.data), status: "authenticated" });
  },
  setSession: (session) =>
    set({
      session,
      status: session ? "authenticated" : "unauthenticated",
    }),
  clear: () => set({ session: null, status: "unauthenticated" }),
}));
