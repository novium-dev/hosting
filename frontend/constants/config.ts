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
};
