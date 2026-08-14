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
import { Trans, useTranslation } from "react-i18next";
import { appConfig } from "../../constants/config";
import { ProviderSignInButton } from "./provider-sign-in-button";
import type { AuthProvider } from "./provider-sign-in-button";

type AuthWrapperProps = {
  title: string;
  description: string;
  providers: AuthProvider[];
};

export default function AuthWrapper({
  title,
  description,
  providers,
}: Readonly<AuthWrapperProps>) {
  const { t } = useTranslation();

  return (
    <Card className="w-full max-w-xs sm:max-w-sm pb-0 relative">
      <CardHeader className="shadow-xs border-none bg-transparent">
        <div className="flex flex-col items-center text-center gap-2">
          <Link href="/" aria-label={t("auth.signIn.goHome")}>
            <NoviumLogo className="size-10 cursor-pointer" />
          </Link>
          <CardTitle className="text-xl font-semibold">{title}</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {providers.map((provider) => (
          <ProviderSignInButton key={provider} provider={provider} />
        ))}
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
