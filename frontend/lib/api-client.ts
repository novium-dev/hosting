import type { CreateClientConfig } from "./api/client.gen";

// The SPA is deployed on its own (nginx image); Traefik routes `/api` on the
// same host to the backend, so a relative base keeps auth cookies same-origin.
// Set VITE_API_URL at build time to point at a backend on another origin.
// `credentials: "include"` sends the httpOnly session cookie the backend sets.
const baseUrl = import.meta.env.VITE_API_URL || "/api";

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl,
  credentials: "include",
});
