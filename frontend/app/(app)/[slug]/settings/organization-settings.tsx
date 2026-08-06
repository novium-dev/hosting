"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AppOrganization } from "@/lib/auth";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UpdateOrganizationName } from "./update-organization-name";
import { UpdateOrganizationSlug } from "./update-organization-slug";
import { Separator } from "@/components/ui/separator";

interface OrganizationSettingsProps {
  organization: AppOrganization;
}

export function OrganizationSettings({
  organization,
}: OrganizationSettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex flex-col">
        <h2 className="text-2xl font-bold">{t("org:settings.heading")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("org:settings.subheading")}
        </p>
      </div>
      <UpdateOrganizationName organization={organization} />

      <UpdateOrganizationSlug organization={organization} />

      <Card>
        <CardHeader>
          <CardTitle>{t("org:settings.dangerZone.title")}</CardTitle>
          <CardDescription>
            {t("org:settings.dangerZone.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* <AlertDestructive>
            <p className="text-sm">
              Deleting your organization will permanently remove all associated
              data, including workspaces, forms, and responses. This action
              cannot be undone.
            </p>
          </AlertDestructive> */}
          <p className="text-sm text-destructive">
            {t("org:settings.dangerZone.deleteWarning")}
          </p>
          <Button variant="destructive" size="sm">
            {t("org:settings.dangerZone.deleteButton")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
