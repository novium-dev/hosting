import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Client-only SPA. The backend serves the built `dist/` at the same origin in
// production, so the API base URL is empty by default. In dev we proxy `/api`
// (and the other backend prefixes) to the backend for cookie-based auth.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_DEV_API_URL ?? "http://localhost:8080";
  const runtimeConfig = JSON.stringify(loadEnv(mode, process.cwd())).replace(
    /</g,
    "\\u003c",
  );
  const appName = escapeHtml(env.VITE_APP_NAME || "Hephaestus");

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "runtime-config",
        apply: "serve",
        transformIndexHtml: (html) =>
          html
            .replace("__RUNTIME_CONFIG_JSON__", () => runtimeConfig)
            .replace(/__APP_NAME__/g, () => appName),
      },
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./", import.meta.url)),
      },
    },
    server: {
      port: 3000,
      proxy: {
        // Same-origin cookie auth in dev: forward /api/* to the backend, which
        // serves its API under /api (no path rewrite).
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
