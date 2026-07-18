"use client";

import { logout, me } from "@/lib/api";
import type { AppSession } from "@/lib/auth";
import useSWR, { mutate } from "swr";

export type AuthClientMember = {
  id: string;
  permissions: number;
  role: "owner" | "admin" | "member";
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
};

export type AuthClientInvitation = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status?: string;
  expiresAt?: Date | string | null;
};

const toSession = async (): Promise<AppSession | null> => {
  const response = await me();
  if (response.error || !response.data) return null;

  const user = response.data;
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
};

type FetchOptions = {
  onSuccess?: () => void;
  onError?: (error: { error: { message: string } }) => void;
};

export const authClient = {
  useSession: () =>
    useSWR("auth/me", toSession, {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }),

  signIn: {
    social: async (
      options: { provider?: string; callbackURL?: string },
      fetchOptions?: FetchOptions,
    ) => {
      const redirectUrl = new URL(
        options.callbackURL ?? "/",
        window.location.origin,
      ).toString();
      const url = new URL(
        `/api/auth/login/${options.provider}`,
        window.location.origin,
      );
      url.searchParams.set("redirect_url", redirectUrl);

      fetchOptions?.onSuccess?.();
      window.location.assign(url.toString());
    },
  },

  signOut: async ({ fetchOptions }: { fetchOptions?: FetchOptions } = {}) => {
    const response = await logout();
    if (response.error) {
      fetchOptions?.onError?.({
        error: { message: "Failed to sign out" },
      });
      return response;
    }
    mutate("auth/me", null, false);
    fetchOptions?.onSuccess?.();
    return response;
  },

  organization: {
    checkSlug: async (_options?: { slug: string }) => ({ error: null }),
  },
};
