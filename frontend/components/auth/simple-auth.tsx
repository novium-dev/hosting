"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LegalFooter, hasLegalLinks } from "@/components/auth/legal-footer";
import { AppLogo, hasLogo } from "@/components/brand/app-logo";
import Link from "@/components/link";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../../lib/auth-client";
import { appConfig } from "../../constants/config";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { TerminalIcon } from "lucide-react";

export default function SimpleAuth() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [isDevLoading, setIsDevLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await authClient.signIn.social(
        {
          provider: "user",
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

  const handleDevSignIn = async () => {
    setIsDevLoading(true);
    try {
      const started = await authClient.signIn.dev({
        callbackURL: appConfig.authRoutes.onboarding,
      });
      if (!started) {
        toast.error(t("common:auth.signIn.devUnavailable"));
      }
    } catch {
      toast.error(t("state.genericError"));
    } finally {
      setIsDevLoading(false);
    }
  };

  return (
    <Card
      className={cn(
        "w-full max-w-xs sm:max-w-sm relative",
        hasLegalLinks && "pb-0",
      )}
    >
      <CardHeader className="shadow-xs border-none bg-transparent">
        <div className="flex flex-col items-center text-center gap-2">
          {hasLogo ? (
            <Link href="/" aria-label={t("auth.signIn.goHome")}>
              <AppLogo className="size-10 cursor-pointer" />
            </Link>
          ) : null}
          <CardTitle className="text-xl font-semibold">
            {t("auth.signIn.title")}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {t("auth.signIn.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="secondary"
          className="w-full"
          loading={isLoading}
          icon={<AppLogo className="size-4" />}
          onClick={handleSignIn}
        >
          {t("auth.signIn.submit")}
        </Button>

        {import.meta.env.DEV ? (
          <div className="space-y-3">
            <Separator />
            <Button
              variant="outline"
              className="w-full"
              loading={isDevLoading}
              icon={<TerminalIcon className="size-4" aria-hidden="true" />}
              onClick={handleDevSignIn}
            >
              {t("common:auth.signIn.devSubmit")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t("common:auth.signIn.devHint")}
            </p>
          </div>
        ) : null}
      </CardContent>
      <LegalFooter />
    </Card>
  );
}
