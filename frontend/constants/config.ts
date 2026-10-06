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

const runtimeConfig = window.__RUNTIME_CONFIG__ ?? {};

const behindCloudflare = parseBoolean(runtimeConfig.VITE_BEHIND_CLOUDFLARE);

export const appConfig: AppConfig = {
  appName: runtimeConfig.VITE_APP_NAME || "Hephaestus",
  logoUrl: optionalUrl(runtimeConfig.VITE_LOGO_URL),
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
    terms: optionalUrl(runtimeConfig.VITE_TERMS_URL),
    privacy: optionalUrl(runtimeConfig.VITE_PRIVACY_URL),
    imprint: optionalUrl(runtimeConfig.VITE_IMPRINT_URL),
  },
  uploads: {
    behindCloudflare,
    maxFileSize: behindCloudflare ? CLOUDFLARE_MAX_UPLOAD_SIZE : null,
  },
};
