"use client";

import { AppLogo } from "@/components/brand/app-logo";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useSigninRedirect } from "@/lib/auth-redirect";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type AuthProvider = "user" | "team";

type ProviderSignInButtonProps = {
  provider: AuthProvider;
};

export function ProviderSignInButton({ provider }: ProviderSignInButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const callbackURL = useSigninRedirect() ?? appConfig.authRoutes.onboarding;

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await authClient.signIn.social(
        {
          provider,
          callbackURL,
        },
        {
          onError: (ctx) => {
            toast.error(ctx.error.message);
          },
        },
      );
    } catch {
      toast.error(t("state.genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="secondary"
      className="w-full"
      loading={isLoading}
      icon={<AppLogo className="size-4" />}
      onClick={handleSignIn}
    >
      {t(`auth.providers.${provider}`)}
    </Button>
  );
}
