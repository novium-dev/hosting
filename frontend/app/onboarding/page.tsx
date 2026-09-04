import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Navigate } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { appConfig } from "@/constants/config";
import { AppFooter } from "@/components/app-footer";
import { AppLogo } from "@/components/brand/app-logo";
import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { useProjectStore } from "@/stores/projects";
import OnboardingForm from "./onboarding-form";

export default function OnboardingPage() {
  const { t } = useTranslation("app");
  const { data, isLoading } = authClient.useSession();
  const { data: projects, isLoading: projectsLoading } = useSWR(
    data ? "onboarding/own-projects" : null,
    () => auth.api.listProjects({ own: true }),
  );
  const currentSlug = useProjectStore((state) => state.currentSlug);

  if (isLoading) return null;
  if (!data) return <Navigate to={appConfig.authRoutes.signin} replace />;
  if (projectsLoading) return null;
  if (projects && projects.length > 0) {
    const preferred =
      currentSlug && projects.some((project) => project.slug === currentSlug)
        ? currentSlug
        : projects[0].slug;
    return <Navigate to={`/${preferred}`} replace />;
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <Card className="w-full max-w-xs sm:max-w-sm relative">
          <CardHeader className="shadow-xs border-none bg-transparent">
            <div className="flex flex-col items-center text-center">
              <AppLogo className="size-10" />
              <div className="flex flex-col">
                <CardTitle className="text-xl font-semibold">
                  {t("onboarding.title")}
                </CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {t("onboarding.description")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <OnboardingForm />
          </CardContent>
        </Card>
      </div>
      <AppFooter />
    </div>
  );
}
