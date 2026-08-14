type AppConfig = {
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
