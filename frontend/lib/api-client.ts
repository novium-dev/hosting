import type { CreateClientConfig } from "./api/client.gen";
import { normalizeCompressedResponse } from "./decompress";
import { getSessionTokenFromCookie } from "./session";

const withAuthorizationHeader = async (init?: RequestInit) => {
  const headers = new Headers(init?.headers);

  // Server-side fetch (undici) does not decompress zstd responses, so the raw
  // compressed body reaches JSON.parse and throws. Ask the backend to skip
  // compression for server-to-server requests. Browsers forbid setting this
  // header, so it only takes effect server-side (which is where the bug is).
  if (typeof window === "undefined") {
    headers.set("Accept-Encoding", "identity");
  }

  if (headers.get("authorization")) {
    return { ...init, headers };
  }

  let cookie = headers.get("cookie");

  if (!cookie && typeof window === "undefined") {
    try {
      const { headers: nextHeaders } = await import("next/headers");
      cookie = (await nextHeaders()).get("cookie");
    } catch {
      cookie = null;
    }
  }

  const sessionToken = getSessionTokenFromCookie(cookie);
  if (sessionToken) {
    headers.set("Authorization", `Session ${sessionToken}`);
  }

  return { ...init, headers };
};

const backendFetch: typeof fetch = async (input, init) => {
  let response = await fetch(input, await withAuthorizationHeader(init));

  if (typeof window === "undefined") {
    response = await normalizeCompressedResponse(response);
  }

  if (response.status >= 500) {
    if (typeof window !== "undefined") {
      return response;
    }

    throw new Error(`Backend request failed with status ${response.status}`);
  }

  return response;
};

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl:
    typeof window !== "undefined"
      ? "/api"
      : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"),
  fetch: backendFetch,
});
