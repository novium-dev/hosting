"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function ProfileSection() {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const { t } = useTranslation();

  const roleLabels: Record<string, string> = {
    admin: t("common:roles.admin"),
    moderator: t("settings:profile.roles.moderator"),
    user: t("common:roles.user"),
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="settings-username">
          {t("common:resources.username")}
        </Label>
        <Input
          id="settings-username"
          value={user?.name ?? ""}
          readOnly
          disabled
        />
        <p className="text-sm text-muted-foreground">
          {t("common:resources.usernameHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-email">{t("common:labels.email")}</Label>
        <Input
          id="settings-email"
          type="email"
          value={user?.email ?? ""}
          readOnly
          disabled
        />
        <p className="text-sm text-muted-foreground">
          {t("settings:profile.emailHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("common:labels.role")}</Label>
        <div>
          <Badge variant="secondary">
            {roleLabels[user?.role ?? "user"] ?? t("common:roles.user")}
          </Badge>
        </div>
      </div>
    </div>
  );
}
