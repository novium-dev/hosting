import type { CreateClientConfig } from "./api/client.gen";

// Client-only SPA. In production the backend serves this bundle at the same
// origin, so the API base URL is empty ("/auth/me" hits the backend directly).
// In dev, Vite proxies "/api" to the backend (see vite.config.ts).
// `credentials: "include"` sends the httpOnly session cookie the backend sets.
const baseUrl =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "/api" : "");

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl,
  credentials: "include",
});
