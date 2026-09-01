type AppConfig = {
  appName: string;
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
    terms: string;
    privacy: string;
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

const behindCloudflare = parseBoolean(
  window.__RUNTIME_CONFIG__?.BEHIND_CLOUDFLARE ||
    import.meta.env.VITE_BEHIND_CLOUDFLARE,
);

export const appConfig: AppConfig = {
  appName:
    window.__RUNTIME_CONFIG__?.APP_NAME ||
    import.meta.env.VITE_APP_NAME ||
    "Hephaestus",
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
    terms: "https://novium.world/agb",
    privacy: "https://novium.world/privacy",
  },
  uploads: {
    behindCloudflare,
    maxFileSize: behindCloudflare ? CLOUDFLARE_MAX_UPLOAD_SIZE : null,
  },
};
