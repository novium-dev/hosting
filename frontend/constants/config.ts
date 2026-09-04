type AppConfig = {
  appName: string;
  logoUrl: string | null;
  authRoutes: {
    default: string;
    signin: string;
    onboarding: string;
  };
  appRoutes: {
    acceptInvitation: string;
    userProfile: string;
  };
  legalLinks: {
    terms: string | null;
    privacy: string | null;
    imprint: string | null;
  };
  uploads: {
    behindCloudflare: boolean;
    maxFileSize: number | null;
  };
};

const CLOUDFLARE_MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

function parseBoolean(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function optionalUrl(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

const behindCloudflare = parseBoolean(
  window.__RUNTIME_CONFIG__?.BEHIND_CLOUDFLARE ||
    import.meta.env.VITE_BEHIND_CLOUDFLARE,
);

export const appConfig: AppConfig = {
  appName:
    window.__RUNTIME_CONFIG__?.APP_NAME ||
    import.meta.env.VITE_APP_NAME ||
    "Hephaestus",
  logoUrl: optionalUrl(
    window.__RUNTIME_CONFIG__?.LOGO_URL || import.meta.env.VITE_LOGO_URL,
  ),
  authRoutes: {
    default: "/",
    signin: "/signin",
    onboarding: "/onboarding",
  },
  appRoutes: {
    acceptInvitation: "/accept-invitation",
    userProfile: "/profile",
  },
  legalLinks: {
    terms: optionalUrl(
      window.__RUNTIME_CONFIG__?.TERMS_URL || import.meta.env.VITE_TERMS_URL,
    ),
    privacy: optionalUrl(
      window.__RUNTIME_CONFIG__?.PRIVACY_URL ||
        import.meta.env.VITE_PRIVACY_URL,
    ),
    imprint: optionalUrl(
      window.__RUNTIME_CONFIG__?.IMPRINT_URL ||
        import.meta.env.VITE_IMPRINT_URL,
    ),
  },
  uploads: {
    behindCloudflare,
    maxFileSize: behindCloudflare ? CLOUDFLARE_MAX_UPLOAD_SIZE : null,
  },
};
