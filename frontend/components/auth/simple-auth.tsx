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
import { authClient } from "../../lib/auth-client";
import { appConfig } from "../../constants/config";
import { toast } from "sonner";
import { Button } from "../ui/button";

export default function SimpleAuth() {
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
      toast.error("Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-xs sm:max-w-sm pb-0 relative">
      <CardHeader className="shadow-xs border-none bg-transparent">
        <div className="flex flex-col items-center text-center gap-2">
          <Link href="/" aria-label="Go to home">
            <NoviumLogo className="size-10 cursor-pointer" />
          </Link>
          <CardTitle className="text-xl font-semibold">Sign In</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Continue with Novium Auth to access your account.
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
          Sign in
        </Button>
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
