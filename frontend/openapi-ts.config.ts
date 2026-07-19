import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "http://localhost:8080/api/docs/openapi.json",
  logs: {
    path: "./logs",
  },
  output: {
    path: "./lib/api",
    postProcess: ["eslint"],
  },
  plugins: [
    {
      name: "@hey-api/client-next",
      runtimeConfigPath: "../api-client",
    },
    "@hey-api/sdk",
    {
      enums: "javascript",
      name: "@hey-api/typescript",
    },
  ],
});
