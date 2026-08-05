"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateServer } from "@/lib/api";

type ServerAdminSettingsProps = {
  serverId: string;
  canManage: boolean;
  canSuspend: boolean;
  initial: {
    internetAccess: boolean;
    suspended: boolean;
    suspensionReason: string | null;
    backupLimit: number | null;
    cpu: number | null;
    ram: number | null;
    swap: number | null;
    disk: number | null;
    customDockerfile: string | null;
  };
};

type FormState = {
  internetAccess: boolean;
  suspended: boolean;
  suspensionReason: string;
  backupLimit: string;
  cpu: string;
  ram: string;
  swap: string;
  disk: string;
  customDockerfile: string;
};

function toInputValue(value: number | null) {
  return value === null ? "" : String(value);
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildInitialForm(
  initial: ServerAdminSettingsProps["initial"],
): FormState {
  return {
    internetAccess: initial.internetAccess,
    suspended: initial.suspended,
    suspensionReason: initial.suspensionReason ?? "",
    backupLimit: toInputValue(initial.backupLimit),
    cpu: toInputValue(initial.cpu),
    ram: toInputValue(initial.ram),
    swap: toInputValue(initial.swap),
    disk: toInputValue(initial.disk),
    customDockerfile: initial.customDockerfile ?? "",
  };
}

export function ServerAdminSettings({
  serverId,
  canManage,
  canSuspend,
  initial,
}: ServerAdminSettingsProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(buildInitialForm(initial));
  const [initialForm, setInitialForm] = useState<FormState>(
    buildInitialForm(initial),
  );
  const [isSaving, setIsSaving] = useState(false);

  const onReset = useCallback(() => {
    setForm(initialForm);
  }, [initialForm]);

  const isFieldDirty = (field: keyof FormState) => {
    return form[field] !== initialForm[field];
  };

  const hasChanges = (Object.keys(form) as Array<keyof FormState>).some(
    (field) => form[field] !== initialForm[field],
  );

  const onSave = async () => {
    const backupLimit = parseNumberOrNull(form.backupLimit);
    const cpu = parseNumberOrNull(form.cpu);
    const ram = parseNumberOrNull(form.ram);
    const swap = parseNumberOrNull(form.swap);
    const disk = parseNumberOrNull(form.disk);

    if (
      (form.backupLimit.trim() && backupLimit === null) ||
      (form.cpu.trim() && cpu === null) ||
      (form.ram.trim() && ram === null) ||
      (form.swap.trim() && swap === null) ||
      (form.disk.trim() && disk === null)
    ) {
      toast.error(t("admin-infra:servers.adminSettings.invalidNumbersError"));
      return;
    }

    if (!hasChanges) {
      return;
    }

    const hasSuspendChange =
      isFieldDirty("suspended") || isFieldDirty("suspensionReason");
    const hasManagementChange = (Object.keys(form) as Array<keyof FormState>)
      .filter((field) => field !== "suspended" && field !== "suspensionReason")
      .some((field) => isFieldDirty(field));

    if (hasSuspendChange && !canSuspend) {
      toast.error(t("admin-infra:servers.adminSettings.noSuspendPermission"));
      return;
    }

    if (form.suspended && !form.suspensionReason.trim()) {
      toast.error(t("admin-infra:servers.adminSettings.suspendReasonRequired"));
      return;
    }

    if (hasManagementChange && !canManage) {
      toast.error(t("admin-infra:servers.adminSettings.noManagePermission"));
      return;
    }

    setIsSaving(true);

    try {
      const response = await updateServer({
        path: { server_id: serverId },
        body: {
          ...(canManage && {
            internet_access: form.internetAccess,
            custom_dockerfile: form.customDockerfile.trim() || null,
            limits: {
              backup: backupLimit,
            },
            resource: {
              cpu,
              ram,
              swap,
              disk,
            },
          }),
          ...(canSuspend &&
            hasSuspendChange && {
              ...(isFieldDirty("suspended") && { suspended: form.suspended }),
              ...(form.suspended && {
                suspension_reason: form.suspensionReason.trim(),
              }),
            }),
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:servers.adminSettings.updateError"),
        );
        return;
      }

      toast.success(t("admin-infra:servers.adminSettings.updateSuccess"));
      setInitialForm(form);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin-infra:servers.adminSettings.title")}</CardTitle>
        <CardDescription>
          {t("admin-infra:servers.adminSettings.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="internet-access">
                  {t("admin-infra:servers.shared.internetAccessLabel")}
                </Label>
                {isFieldDirty("internetAccess") ? (
                  <span className="text-xs font-medium text-amber-600">
                    {t("admin-infra:servers.adminSettings.editedBadge")}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("admin-infra:servers.adminSettings.internetAccessHint")}
              </p>
            </div>
            <Switch
              id="internet-access"
              checked={form.internetAccess}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, internetAccess: checked }))
              }
              disabled={!canManage}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="suspended">{t("common:status.suspended")}</Label>
                {isFieldDirty("suspended") ? (
                  <span className="text-xs font-medium text-amber-600">
                    {t("admin-infra:servers.adminSettings.editedBadge")}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("admin-infra:servers.adminSettings.suspendedHint")}
              </p>
            </div>
            <Switch
              id="suspended"
              checked={form.suspended}
              onCheckedChange={(checked) =>
                setForm((prev) => ({
                  ...prev,
                  suspended: checked,
                  suspensionReason: checked ? prev.suspensionReason : "",
                }))
              }
              disabled={!canSuspend}
            />
          </div>
        </div>

        {form.suspended ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="suspension-reason">
                {t("admin-infra:servers.adminSettings.suspensionReasonLabel")}
              </Label>
              {isFieldDirty("suspensionReason") ? (
                <span className="text-xs font-medium text-amber-600">
                  {t("admin-infra:servers.adminSettings.editedBadge")}
                </span>
              ) : null}
            </div>
            <Textarea
              id="suspension-reason"
              value={form.suspensionReason}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  suspensionReason: event.target.value,
                }))
              }
              placeholder={t(
                "admin-infra:servers.adminSettings.suspensionReasonPlaceholder",
              )}
              rows={2}
              maxLength={512}
              disabled={!canSuspend}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin-infra:servers.adminSettings.suspensionReasonHint")}
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-backup">
                {t("admin-infra:servers.shared.backupLimitLabel")}
              </Label>
              {isFieldDirty("backupLimit") ? (
                <span className="text-xs font-medium text-amber-600">
                  {t("admin-infra:servers.adminSettings.editedBadge")}
                </span>
              ) : null}
            </div>
            <Input
              id="limit-backup"
              value={form.backupLimit}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  backupLimit: event.target.value,
                }))
              }
              placeholder={t(
                "admin-infra:servers.adminSettings.unlimitedPlaceholder",
              )}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-cpu">
                {t("admin-infra:servers.adminSettings.cpuLimitLabel")}
              </Label>
              {isFieldDirty("cpu") ? (
                <span className="text-xs font-medium text-amber-600">
                  {t("admin-infra:servers.adminSettings.editedBadge")}
                </span>
              ) : null}
            </div>
            <Input
              id="limit-cpu"
              value={form.cpu}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, cpu: event.target.value }))
              }
              placeholder={t(
                "admin-infra:servers.adminSettings.unlimitedPlaceholder",
              )}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-ram">
                {t("admin-infra:servers.adminSettings.ramLimitLabel")}
              </Label>
              {isFieldDirty("ram") ? (
                <span className="text-xs font-medium text-amber-600">
                  {t("admin-infra:servers.adminSettings.editedBadge")}
                </span>
              ) : null}
            </div>
            <Input
              id="limit-ram"
              value={form.ram}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, ram: event.target.value }))
              }
              placeholder={t(
                "admin-infra:servers.adminSettings.unlimitedPlaceholder",
              )}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-swap">
                {t("admin-infra:servers.adminSettings.swapLimitLabel")}
              </Label>
              {isFieldDirty("swap") ? (
                <span className="text-xs font-medium text-amber-600">
                  {t("admin-infra:servers.adminSettings.editedBadge")}
                </span>
              ) : null}
            </div>
            <Input
              id="limit-swap"
              value={form.swap}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, swap: event.target.value }))
              }
              placeholder={t(
                "admin-infra:servers.adminSettings.unlimitedPlaceholder",
              )}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-disk">
                {t("admin-infra:servers.adminSettings.diskLimitLabel")}
              </Label>
              {isFieldDirty("disk") ? (
                <span className="text-xs font-medium text-amber-600">
                  {t("admin-infra:servers.adminSettings.editedBadge")}
                </span>
              ) : null}
            </div>
            <Input
              id="limit-disk"
              value={form.disk}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, disk: event.target.value }))
              }
              placeholder={t(
                "admin-infra:servers.adminSettings.unlimitedPlaceholder",
              )}
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="dockerfile">
              {t("admin-infra:servers.adminSettings.customDockerfileLabel")}
            </Label>
            {isFieldDirty("customDockerfile") ? (
              <span className="text-xs font-medium text-amber-600">
                {t("admin-infra:servers.adminSettings.editedBadge")}
              </span>
            ) : null}
          </div>
          <Textarea
            id="dockerfile"
            value={form.customDockerfile}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                customDockerfile: event.target.value,
              }))
            }
            placeholder={t(
              "admin-infra:servers.adminSettings.customDockerfilePlaceholder",
            )}
            rows={6}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => {
              void onSave();
            }}
            loading={isSaving}
            disabled={!hasChanges || isSaving || (!canManage && !canSuspend)}
          >
            {t("admin-infra:servers.adminSettings.saveButton")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            disabled={isSaving}
          >
            {t("common:actions.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
