"use client";

import { Button } from "@/components/ui/button";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type AuthProvider = "user" | "team";

const providerIcons: Record<AuthProvider, string> = {
  user: "https://logos.novium.world/?format=svg",
  team: "https://logos.novium.world/?variante=team&format=svg",
};

type ProviderSignInButtonProps = {
  provider: AuthProvider;
};

export function ProviderSignInButton({ provider }: ProviderSignInButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await authClient.signIn.social(
        {
          provider,
          callbackURL: appConfig.authRoutes.onboarding,
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
      icon={
        <img
          src={providerIcons[provider]}
          alt=""
          className="size-4"
          aria-hidden="true"
        />
      }
      onClick={handleSignIn}
    >
      {t(`auth.providers.${provider}`)}
    </Button>
  );
}
