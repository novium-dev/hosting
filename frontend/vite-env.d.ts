/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEV_API_URL?: string;
  readonly VITE_PROVIDERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
