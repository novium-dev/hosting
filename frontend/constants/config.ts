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
};

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
};
