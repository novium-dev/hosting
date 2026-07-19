import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Navigate } from "react-router-dom";
import useSWR from "swr";
import { appConfig } from "@/constants/config";
import { NoviumLogo } from "@/components/brand/novium-logo";
import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { useOrganizationStore } from "@/stores/organizations";
import OnboardingForm from "./onboarding-form";

export default function OnboardingPage() {
  const { data, isLoading } = authClient.useSession();
  const { data: organizations, isLoading: orgsLoading } = useSWR(
    data ? "onboarding/own-organizations" : null,
    () => auth.api.listOrganizations({ own: true }),
  );
  const currentSlug = useOrganizationStore((state) => state.currentSlug);

  if (isLoading) return null;
  if (!data) return <Navigate to={appConfig.authRoutes.signin} replace />;
  if (orgsLoading) return null;
  if (organizations && organizations.length > 0) {
    const preferred =
      currentSlug && organizations.some((org) => org.slug === currentSlug)
        ? currentSlug
        : organizations[0].slug;
    return <Navigate to={`/${preferred}`} replace />;
  }

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
