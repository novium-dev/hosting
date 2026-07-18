"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { appConfig } from "@/constants/config";
import { NoviumLogo } from "@/components/brand/novium-logo";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "nextjs-toploader/app";

export default function InvalidInvitationCard() {
  const router = useRouter();
  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push(appConfig.authRoutes.signin);
        },
      },
    });
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Card className="w-full max-w-xs sm:max-w-sm relative">
        <CardHeader className="border-none bg-transparent">
          <div className="flex flex-col items-center text-center gap-2">
            <NoviumLogo className="size-10" />
            <CardTitle className="text-xl font-semibold">
              Oops! Something is not right
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 justify-center items-center">
          <p className="text-center text-sm">
            You are not allowed to accept this invitation. Use different account
            and try again.
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Try signing out and signing in with valid account.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col justify-center gap-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/")}>
              Home
            </Button>
            <Button onClick={handleSignOut}>Sign out</Button>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Note: If you are not able to sign out, please contact support.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
