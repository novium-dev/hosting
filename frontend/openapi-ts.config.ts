export default {
  input: "http://localhost:8080/api/docs/openapi.json",
  logs: {
    path: "./logs",
  },
  output: {
    path: "./lib/api",
  },
  plugins: [
    {
      name: "@hey-api/client-next",
      runtimeConfigPath: "./lib/api-client",
    },
    "@hey-api/sdk",
    {
      enums: "javascript",
      name: "@hey-api/typescript",
    },
  ],
};
