"use client";

import { AdminBypassAlert } from "@/components/admin-bypass-alert";
import { CreateProjectForm } from "@/components/create-project-form";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/lib/navigation";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { useTranslation } from "react-i18next";

export default function OnboardingForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const { canCreateProject, projectCreationBypassed, isLoading } =
    useInstancePolicy();

  if (isLoading) return null;

  return (
    <div className="flex flex-col gap-4">
      {projectCreationBypassed && (
        <AdminBypassAlert
          description={t("common:policy.projectCreationAdminOnly")}
        />
      )}
      {canCreateProject ? (
        <CreateProjectForm onSuccess={({ slug }) => router.push(`/${slug}`)} />
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          {t("common:policy.projectCreationDisabled")}
        </p>
      )}
      <Button
        variant="outline"
        onClick={() => {
          authClient.signOut({
            fetchOptions: {
              onSuccess: () => router.push(appConfig.authRoutes.signin),
            },
          });
        }}
      >
        {t("actions.signOut")}
      </Button>
    </div>
  );
}
