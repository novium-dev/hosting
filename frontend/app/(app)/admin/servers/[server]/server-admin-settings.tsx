"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

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
      toast.error(
        "Please enter valid numeric values or leave fields empty for unlimited",
      );
      return;
    }

    if (!hasChanges) {
      return;
    }

    const hasSuspendChange = isFieldDirty("suspended");
    const hasManagementChange = (Object.keys(form) as Array<keyof FormState>)
      .filter((field) => field !== "suspended")
      .some((field) => isFieldDirty(field));

    if (hasSuspendChange && !canSuspend) {
      toast.error("You do not have permission to suspend this server");
      return;
    }

    if (hasManagementChange && !canManage) {
      toast.error("You do not have permission to manage this server");
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
          ...(canSuspend && { suspended: form.suspended }),
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? "Failed to update server settings",
        );
        return;
      }

      toast.success("Server settings updated");
      setInitialForm(form);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server Admin Settings</CardTitle>
        <CardDescription>
          Update admin-only server settings and runtime limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="internet-access">Internet Access</Label>
                {isFieldDirty("internetAccess") ? (
                  <span className="text-xs font-medium text-amber-600">
                    Edited
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Allow outbound internet from the server.
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
                <Label htmlFor="suspended">Suspended</Label>
                {isFieldDirty("suspended") ? (
                  <span className="text-xs font-medium text-amber-600">
                    Edited
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Suspend or unsuspend this server.
              </p>
            </div>
            <Switch
              id="suspended"
              checked={form.suspended}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, suspended: checked }))
              }
              disabled={!canSuspend}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-backup">Backup Limit</Label>
              {isFieldDirty("backupLimit") ? (
                <span className="text-xs font-medium text-amber-600">
                  Edited
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
              placeholder="Empty = unlimited"
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-cpu">CPU Limit</Label>
              {isFieldDirty("cpu") ? (
                <span className="text-xs font-medium text-amber-600">
                  Edited
                </span>
              ) : null}
            </div>
            <Input
              id="limit-cpu"
              value={form.cpu}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, cpu: event.target.value }))
              }
              placeholder="Empty = unlimited"
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-ram">RAM Limit (bytes)</Label>
              {isFieldDirty("ram") ? (
                <span className="text-xs font-medium text-amber-600">
                  Edited
                </span>
              ) : null}
            </div>
            <Input
              id="limit-ram"
              value={form.ram}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, ram: event.target.value }))
              }
              placeholder="Empty = unlimited"
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-swap">Swap Limit (bytes)</Label>
              {isFieldDirty("swap") ? (
                <span className="text-xs font-medium text-amber-600">
                  Edited
                </span>
              ) : null}
            </div>
            <Input
              id="limit-swap"
              value={form.swap}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, swap: event.target.value }))
              }
              placeholder="Empty = unlimited"
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="limit-disk">Disk Limit (bytes)</Label>
              {isFieldDirty("disk") ? (
                <span className="text-xs font-medium text-amber-600">
                  Edited
                </span>
              ) : null}
            </div>
            <Input
              id="limit-disk"
              value={form.disk}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, disk: event.target.value }))
              }
              placeholder="Empty = unlimited"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="dockerfile">Custom Dockerfile</Label>
            {isFieldDirty("customDockerfile") ? (
              <span className="text-xs font-medium text-amber-600">Edited</span>
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
            placeholder="Optional custom Dockerfile content"
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
            Save Admin Settings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            disabled={isSaving}
          >
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
