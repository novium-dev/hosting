"use client";

import { Button } from "@/components/ui/button";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { toast } from "sonner";

export type AuthProvider = "user" | "team";

const providerCopy: Record<AuthProvider, { label: string; icon: string }> = {
  user: {
    label: "User",
    icon: "https://logos.novium.world/?format=svg",
  },
  team: {
    label: "Team",
    icon: "https://logos.novium.world/?variante=team&format=svg",
  },
};

type ProviderSignInButtonProps = {
  provider: AuthProvider;
};

export function ProviderSignInButton({ provider }: ProviderSignInButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const copy = providerCopy[provider];

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
      toast.error("Something went wrong");
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
        <img src={copy.icon} alt="" className="size-4" aria-hidden="true" />
      }
      onClick={handleSignIn}
    >
      {copy.label}
    </Button>
  );
}
