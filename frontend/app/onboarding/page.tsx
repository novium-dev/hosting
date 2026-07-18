import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { appConfig } from "@/constants/config";
import { NoviumLogo } from "@/components/brand/novium-logo";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import OnboardingForm from "./onboarding-form";

export default async function OnboardingPage() {
  const data = await auth.api.getSession({
    headers: await headers(),
  });
  if (!data) redirect(appConfig.authRoutes.signin);

  const organizations = await auth.api.listOrganizations({
    headers: await headers(),
    own: true,
  });

  if (organizations.length > 0) redirect(`/${organizations[0].slug}`);

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Card className="w-full max-w-xs sm:max-w-sm relative">
        <CardHeader className="shadow-xs border-none bg-transparent">
          <div className="flex flex-col items-center text-center">
            <NoviumLogo className="size-10" />
            <div className="flex flex-col">
              <CardTitle className="text-xl font-semibold">
                Create your organization
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Create your organization to get started
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <OnboardingForm />
        </CardContent>
      </Card>
    </div>
  );
}
