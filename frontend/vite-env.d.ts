/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEV_API_URL?: string;
  readonly VITE_PROVIDERS?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_IMPRINT_URL?: string;
  readonly VITE_BEHIND_CLOUDFLARE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __RUNTIME_CONFIG__?: {
    APP_NAME?: string;
    LOGO_URL?: string;
    TERMS_URL?: string;
    PRIVACY_URL?: string;
    IMPRINT_URL?: string;
    BEHIND_CLOUDFLARE?: string;
  };
}
