"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NoviumLogo } from "@/components/brand/novium-logo";
import Link from "@/components/link";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { authClient } from "../../lib/auth-client";
import { appConfig } from "../../constants/config";
import { toast } from "sonner";
import { Button } from "../ui/button";

export default function SimpleAuth() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <Card className="w-full max-w-xs sm:max-w-sm pb-0 relative">
      <CardHeader className="shadow-xs border-none bg-transparent">
        <div className="flex flex-col items-center text-center gap-2">
          <Link href="/" aria-label={t("auth.signIn.goHome")}>
            <NoviumLogo className="size-10 cursor-pointer" />
          </Link>
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
          icon={
            <img
              src="https://logos.novium.world/?format=svg"
              alt=""
              className="size-4"
              aria-hidden="true"
            />
          }
          onClick={handleSignIn}
        >
          {t("auth.signIn.submit")}
        </Button>
      </CardContent>
      <CardFooter className="bg-muted rounded-b-lg p-4">
        <div className="text-xs text-center text-muted-foreground">
          <Trans
            i18nKey="auth.signIn.terms"
            components={{
              termsLink: (
                <a
                  href={appConfig.legalLinks.terms}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                />
              ),
              privacyLink: (
                <a
                  href={appConfig.legalLinks.privacy}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                />
              ),
            }}
          />
        </div>
      </CardFooter>
    </Card>
  );
}
