/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEV_API_URL?: string;
  readonly VITE_PROVIDERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __RUNTIME_CONFIG__?: {
    readonly VITE_APP_NAME?: string;
    readonly VITE_LOGO_URL?: string;
    readonly VITE_TERMS_URL?: string;
    readonly VITE_PRIVACY_URL?: string;
    readonly VITE_IMPRINT_URL?: string;
    readonly VITE_BEHIND_CLOUDFLARE?: string;
  };
}
