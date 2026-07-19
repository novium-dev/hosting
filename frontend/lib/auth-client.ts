import { checkProjectSlug, logout } from "@/lib/api";
import { useSession } from "@/contexts/session-provider";
import { useOrganizationStore } from "@/stores/organizations";
import { useSessionStore } from "@/stores/session";

// Matches the API base in lib/api-client.ts: the backend serves its API under
// `/api` (same origin as the SPA), proxied by Vite in dev.
const apiBaseUrl = import.meta.env.VITE_API_URL ?? "/api";

export type AuthClientMember = {
  id: string;
  permissions: number;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
};

type FetchOptions = {
  onSuccess?: () => void;
  onError?: (error: { error: { message: string } }) => void;
};

export const authClient = {
  // Reads the shared session from context (fetched once by SessionProvider).
  useSession,

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
        `${apiBaseUrl}/auth/login/${options.provider}`,
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
    // Clear the cached session and org data for the signed-out user.
    useSessionStore.getState().clear();
    useOrganizationStore.getState().clear();
    fetchOptions?.onSuccess?.();
    return response;
  },

  organization: {
    // Returns `{ error }` where a truthy error means the slug is taken, matching
    // the shape the forms expect. Fails open on a request error (the backend
    // still enforces uniqueness on create/update).
    checkSlug: async ({ slug }: { slug: string }) => {
      const response = await checkProjectSlug({ query: { slug } });
      if (response.error) return { error: null };
      return { error: response.data ? { code: "SLUG_TAKEN" as const } : null };
    },
  },
};
