"use client";

import { useCallback, useEffect, useState } from "react";
import { useSettingsDialog } from "@/hooks/use-settings-dialog";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  Network,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listBackups, serverInfo, updateServer, wipeServer } from "@/lib/api";
import { allowsWipe, statusFromLabel } from "@/lib/server-status";
import { useServerStatus } from "@/stores/server-status";
import { useServerTaskLock } from "@/stores/server-tasks";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import { ServerLicenseList } from "./server-licenses";

type ServerSettingsProps = {
  serverId: string;
  username: string;
  nodeHostname: string;
  sshPort: number | null;
  canWriteFiles: boolean;
  canCreateBackup: boolean;
};

export function ServerSettings({
  serverId,
  username,
  nodeHostname,
  sshPort,
  canWriteFiles,
  canCreateBackup,
}: ServerSettingsProps) {
  const { t } = useTranslation();
  const { open: openSettings } = useSettingsDialog();
  const [name, setName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sftpUrl, setSftpUrl] = useState("");
  const [wipeOpen, setWipeOpen] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [wipeWithBackup, setWipeWithBackup] = useState(false);
  const [backupSlotFree, setBackupSlotFree] = useState(false);
  const [infoState, setInfoState] = useState<string | null>(null);

  const liveStatus = useServerStatus(serverId);
  const wipeLock = useServerTaskLock(serverId, "storage", "write");
  const showWipeLock = wipeLock.blocking?.kind !== "server_running";
  const status =
    liveStatus === "unknown" && infoState
      ? statusFromLabel(infoState)
      : liveStatus;
  const canWipe = allowsWipe(status);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await serverInfo({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error(t("servers:settings.toasts.loadFailed"));
      }

      const nextName = response.data.name;
      setName(nextName);
      setInitialName(nextName);
      setInfoState(response.data.state ?? null);
    } catch {
      toast.error(t("servers:settings.toasts.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [serverId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const host = nodeHostname || t("common:status.unknown");
    const portPart = sshPort ? `:${sshPort}` : "";

    setSftpUrl(`sftp://${encodeURIComponent(username)}@${host}${portPart}`);
  }, [serverId, username, nodeHostname, sshPort, t]);

  const refreshStatus = useCallback(async () => {
    const response = await serverInfo({ path: { server_id: serverId } });

    if (response.error || !response.data) {
      return;
    }

    setInfoState(response.data.state ?? null);
  }, [serverId]);

  const refreshBackupSlot = useCallback(async () => {
    if (!canCreateBackup) {
      setBackupSlotFree(false);
      return;
    }

    const [info, backups] = await Promise.all([
      serverInfo({ path: { server_id: serverId } }),
      listBackups({ path: { server_id: serverId } }),
    ]);

    if (info.error || !info.data || backups.error || !backups.data) {
      setBackupSlotFree(false);
      return;
    }

    const limit = info.data.limits.backup ?? null;
    setBackupSlotFree(limit === null || backups.data.length < limit);
  }, [canCreateBackup, serverId]);

  const canSave =
    name.trim().length > 0 && name.trim() !== initialName && !isSaving;

  const isNameDirty = name.trim() !== initialName;

  const onSave = async () => {
    const nextName = name.trim();
    if (!nextName || nextName === initialName) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await updateServer({
        path: { server_id: serverId },
        body: {
          name: nextName,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("servers:settings.toasts.updateFailed"),
        );
        return;
      }

      toast.success(t("servers:settings.toasts.updateSuccess"));
      setInitialName(nextName);
      setName(nextName);
    } finally {
      setIsSaving(false);
    }
  };

  const onWipe = async () => {
    setIsWiping(true);

    try {
      const withBackup = wipeWithBackup && canCreateBackup && backupSlotFree;
      const response = await wipeServer({
        path: { server_id: serverId },
        body: withBackup,
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? t("servers:settings.toasts.wipeFailed"),
        );
        return;
      }

      toast.success(
        withBackup
          ? t("servers:settings.toasts.wipeSuccessWithBackup")
          : t("servers:settings.toasts.wipeSuccess"),
      );
      setWipeOpen(false);
      setWipeWithBackup(false);
    } finally {
      setIsWiping(false);
    }
  };

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(username);
      toast.success(t("servers:settings.toasts.usernameCopySuccess"));
    } catch {
      toast.error(t("servers:settings.toasts.usernameCopyFailed"));
    }
  };

  const copySftpUrl = async () => {
    try {
      await navigator.clipboard.writeText(sftpUrl);
      toast.success(t("servers:settings.toasts.urlCopySuccess"));
    } catch {
      toast.error(t("servers:settings.toasts.urlCopyFailed"));
    }
  };

  return (
    <div className="space-y-4">
      <UnsavedChangesGuard when={isNameDirty} />
      <Card>
        <CardHeader>
          <CardTitle>{t("common:nav.settings")}</CardTitle>
          <CardDescription>{t("servers:settings.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("servers:settings.loading")}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {t("servers:settings.serverNameLabel")}
                  </p>
                  {isNameDirty ? (
                    <span className="text-xs font-medium text-amber-600">
                      {t("servers:shared.edited")}
                    </span>
                  ) : null}
                </div>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("servers:settings.serverNameLabel")}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    void onSave();
                  }}
                  loading={isSaving}
                  disabled={!canSave}
                >
                  {t("servers:settings.saveNameButton")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void refresh();
                  }}
                  disabled={isSaving}
                >
                  {t("common:actions.reset")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ServerLicenseList serverId={serverId} />

      {sshPort != null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="size-5 text-muted-foreground" />
              {t("servers:settings.sftp.title")}
            </CardTitle>
            <CardDescription>
              {t("servers:settings.sftp.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("common:resources.username")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={username} className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void copyUsername();
                  }}
                >
                  <Copy className="size-4" />
                  {t("common:actions.copy")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("servers:settings.sftp.openLabel")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={sftpUrl} className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void copySftpUrl();
                  }}
                  disabled={!sftpUrl}
                >
                  <Copy className="size-4" />
                  {t("common:actions.copy")}
                </Button>
                <Button asChild variant="outline" className="shrink-0">
                  <a href={sftpUrl}>
                    <FolderOpen className="size-4" />
                    {t("servers:settings.sftp.openButton")}
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border bg-background/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {t("servers:settings.sftp.helpText")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => openSettings("daemon")}
              >
                <ExternalLink className="size-4" />
                {t("common:resources.daemonAuth")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {canWriteFiles && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>{t("servers:settings.wipe.title")}</CardTitle>
            <CardDescription>
              {t("servers:settings.wipe.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setWipeWithBackup(false);
                setWipeOpen(true);
                void refreshStatus();
                void refreshBackupSlot();
              }}
              disabled={isWiping || !canWipe || wipeLock.locked}
            >
              <Trash2 className="size-4" />
              {t("servers:settings.wipe.button")}
            </Button>
            {showWipeLock ? <TaskLockNotice lock={wipeLock} /> : null}
            {canWipe ? null : (
              <p className="text-xs text-muted-foreground">
                {t("servers:settings.wipe.requiresStopped")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers:settings.wipe.dialogTitle", {
                name: initialName || t("servers:settings.wipe.thisServer"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers:settings.wipe.dialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {canWipe ? null : (
            <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              {t("servers:settings.wipe.requiresStopped")}
            </p>
          )}

          {showWipeLock ? <TaskLockNotice lock={wipeLock} /> : null}

          {canCreateBackup && backupSlotFree && (
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                id="wipe-backup"
                checked={wipeWithBackup}
                onCheckedChange={(checked) =>
                  setWipeWithBackup(checked === true)
                }
                disabled={isWiping}
              />
              <div className="space-y-1">
                <Label htmlFor="wipe-backup">
                  {t("servers:settings.wipe.backupCheckboxLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("servers:settings.wipe.backupCheckboxHelp")}
                </p>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWiping}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void onWipe();
              }}
              disabled={isWiping || !canWipe || wipeLock.locked}
            >
              {wipeWithBackup
                ? t("servers:settings.wipe.confirmWithBackupButton")
                : t("servers:settings.wipe.confirmButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
