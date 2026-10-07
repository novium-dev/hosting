"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { updateUser } from "@/lib/api";
import type { GetUserResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export function UserSettingsCard({
  user,
  canManage,
  onUpdated,
}: {
  user: GetUserResponse;
  canManage: boolean;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(String(user.role));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const response = await updateUser({
      path: { user_id: user.id },
      body: {
        username:
          username.trim() !== user.username ? username.trim() : undefined,
        email: email.trim() !== user.email ? email.trim() : undefined,
        role: Number(role) !== user.role ? Number(role) : undefined,
      },
    }).finally(() => setSaving(false));

    if (response.error) {
      toast.error(t("admin-core:users.settingsCard.updateFailed"));
      return;
    }

    toast.success(t("admin-core:users.settingsCard.updateSuccess"));
    onUpdated();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin-core:users.settingsCard.title")}</CardTitle>
        <CardDescription>
          {t("admin-core:users.settingsCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="user-username">
              {t("common:resources.username")}
            </Label>
            <Input
              id="user-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">{t("common:labels.email")}</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-role">{t("common:labels.role")}</Label>
            <Select
              items={[
                { value: "0", label: t("common:roles.user") },
                { value: "1", label: t("admin-core:users.roles.moderator") },
                { value: "2", label: t("common:roles.admin") },
              ]}
              value={role}
              onValueChange={(value) => setRole(value ?? "")}
              disabled={!canManage}
            >
              <SelectTrigger id="user-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("common:roles.user")}</SelectItem>
                <SelectItem value="1">
                  {t("admin-core:users.roles.moderator")}
                </SelectItem>
                <SelectItem value="2">{t("common:roles.admin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardFooter className="flex flex-row items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {canManage
            ? t("admin-core:users.settingsCard.canManageHint")
            : t("admin-core:users.settingsCard.cannotManageHint")}
        </p>
        <Button
          size="sm"
          onClick={handleSave}
          loading={saving}
          disabled={!canManage}
        >
          {t("common:resources.saveChanges")}
        </Button>
      </CardFooter>
    </Card>
  );
}
