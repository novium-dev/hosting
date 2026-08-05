"use client";

import { CreateOrganizationForm } from "@/components/create-organization-form";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/lib/navigation";
import { useTranslation } from "react-i18next";

export default function OnboardingForm() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <CreateOrganizationForm
        onSuccess={({ slug }) => router.push(`/${slug}`)}
      />
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
