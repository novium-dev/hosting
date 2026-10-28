"use client";

import { AdminBypassAlert } from "@/components/admin-bypass-alert";
import { AppFooter } from "@/components/app-footer";
import { AppLogo } from "@/components/brand/app-logo";
import { CreateProjectForm } from "@/components/create-project-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "@/components/link";
import { useRouter } from "@/lib/navigation";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { useTranslation } from "react-i18next";

export default function CreateProjectPage() {
  const { t } = useTranslation(["app", "common"]);
  const router = useRouter();
  const { canCreateProject, projectCreationBypassed, isLoading } =
    useInstancePolicy();

  if (isLoading) return null;

  return (
    <div className="flex h-svh flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <Card className="w-full max-w-xs sm:max-w-sm">
          <CardHeader className="flex flex-col items-center gap-2">
            <AppLogo className="size-8" />
            <CardTitle>{t("app:createProjectPage.title")}</CardTitle>
            <CardDescription>
              {t("app:createProjectPage.description")}
            </CardDescription>
            <Link
              href="/"
              className="text-sm text-muted-foreground underline underline-offset-3 hover:text-primary"
            >
              {t("common:actions.backToDashboard")}
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {projectCreationBypassed && (
              <AdminBypassAlert
                description={t("common:policy.projectCreationAdminOnly")}
              />
            )}
            {canCreateProject ? (
              <CreateProjectForm
                onSuccess={({ slug }) => {
                  router.push(`/${slug}`);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("common:policy.projectCreationDisabled")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <AppFooter />
    </div>
  );
}
