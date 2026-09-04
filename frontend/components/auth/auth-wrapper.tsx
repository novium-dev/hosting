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
import { useTranslation } from "react-i18next";
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
      <LegalFooter />
    </Card>
  );
}
