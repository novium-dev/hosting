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
import Link from "next/link";
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
  return (
    <Card className="w-full max-w-xs sm:max-w-sm pb-0 relative">
      <CardHeader className="shadow-xs border-none bg-transparent">
        <div className="flex flex-col items-center text-center gap-2">
          <Link href="/" aria-label="Go to home">
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
          By signing in, you agree to our{" "}
          <Link href="/terms-of-use">Terms of Use</Link> and{" "}
          <Link href="/privacy-policy">Privacy Policy</Link>.
        </div>
      </CardFooter>
    </Card>
  );
}
