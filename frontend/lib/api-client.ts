import type { CreateClientConfig } from "./api/client.gen";

// Client-only SPA. The backend serves its API under `/api` (same origin as the
// served SPA), so "/api/auth/me" hits the backend directly in production. In dev,
// Vite proxies "/api" to the backend (see vite.config.ts).
// `credentials: "include"` sends the httpOnly session cookie the backend sets.
const baseUrl = import.meta.env.VITE_API_URL ?? "/api";

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl,
  credentials: "include",
});
