"use client";

import { apiErrorMessage } from "@/lib/api-error";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  Download,
  HardDrive,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  listBackups,
  restoreBackup,
  updateBackup,
  type ListBackupsResponses,
} from "@/lib/api";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import { useServerTaskLock } from "@/stores/server-tasks";

type BackupsManagerProps = {
  serverId: string;
  /** How many backups the server may hold, `null` when it is unlimited. */
  backupLimit: number | null;
  canBypassLimits: boolean;
};

type BackupRow = ListBackupsResponses[200][number];

type BackupAction = "download" | "restore" | "delete" | "rename";

function formatBytes(bytes: number | null | undefined, unknownLabel: string) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return unknownLabel;
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(2)} ${unit}`;
}

function formatTime(timestamp: number, unknownLabel: string) {
  const normalized =
    timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return unknownLabel;
  }

  return date.toLocaleString();
}

function backupIdFromRow(backup: BackupRow) {
  return Number(backup.time);
}

function backupRowKey(backup: BackupRow) {
  return `${backup.storage}-${backup.time}`;
}

export function BackupsManager({
  serverId,
  backupLimit,
  canBypassLimits,
}: BackupsManagerProps) {
  const { t } = useTranslation();
  const storageLock = useServerTaskLock(serverId, "storage", "read");
  const restoreLock = useServerTaskLock(serverId, "storage", "write");
  const {
    data: backups = [],
    isValidating: isLoading,
    mutate,
  } = useSWR<BackupRow[]>(
    ["server-backups", serverId],
    async () => {
      const response = await listBackups({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error(t("servers:backups.toasts.loadFailed"));
      }

      const sorted = [...response.data].sort((a, b) => b.time - a.time);
      return sorted;
    },
    { onError: () => toast.error(t("servers:backups.toasts.loadFailed")) },
  );
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [protectingKey, setProtectingKey] = useState<string | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<BackupRow | null>(null);

  const atBackupLimit = backupLimit !== null && backups.length >= backupLimit;
  const backupLimitPercent =
    backupLimit === null || backupLimit === 0
      ? 0
      : Math.min(100, (backups.length / backupLimit) * 100);

  const selectedBackupId = useMemo(
    () => (selectedBackup ? backupIdFromRow(selectedBackup) : null),
    [selectedBackup],
  );
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const handleCreateBackup = async () => {
    setIsActionLoading(true);

    try {
      const name = createName.trim();
      const response = await createBackup({
        path: {
          server_id: serverId,
        },
        query: name.length > 0 ? { name } : undefined,
      });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers:backups.toasts.createFailed"),
          ),
        );
        return;
      }

      toast.success(t("servers:backups.toasts.createSuccess"));
      setCreateOpen(false);
      setCreateName("");
      await refresh();
    } finally {
      setIsActionLoading(false);
    }
  };

  const withSelectedBackup = async (
    action: BackupAction,
    operation: (backup: BackupRow, backupId: number) => Promise<void>,
  ) => {
    if (
      !selectedBackup ||
      selectedBackupId === null ||
      Number.isNaN(selectedBackupId)
    ) {
      toast.error(t("servers:backups.toasts.invalidSelection"));
      return;
    }

    setIsActionLoading(true);

    try {
      await operation(selectedBackup, selectedBackupId);

      if (action === "delete") {
        setDeleteOpen(false);
      }

      if (action === "restore") {
        setRestoreOpen(false);
      }

      if (action === "rename") {
        setRenameOpen(false);
      }

      await refresh();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDownload = async (backup: BackupRow) => {
    const backupId = backupIdFromRow(backup);

    if (Number.isNaN(backupId)) {
      toast.error(t("servers:backups.toasts.invalidId"));
      return;
    }

    setIsActionLoading(true);

    try {
      const response = await downloadBackup({
        path: {
          server_id: serverId,
          backup_storage: backup.storage,
          backup_id: backupId,
        },
      });

      if (response.error || !response.data) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers:backups.toasts.downloadUrlFailed"),
          ),
        );
        return;
      }

      window.open(response.data, "_blank", "noopener,noreferrer");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRename = async () => {
    await withSelectedBackup("rename", async (backup, backupId) => {
      const response = await updateBackup({
        path: {
          server_id: serverId,
          backup_storage: backup.storage,
          backup_id: backupId,
        },
        query: { name: renameName.trim() },
      });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers:backups.toasts.renameFailed"),
          ),
        );
        return;
      }

      toast.success(t("servers:backups.toasts.renameSuccess"));
    });
  };

  const handleToggleProtected = async (backup: BackupRow) => {
    const backupId = backupIdFromRow(backup);

    if (Number.isNaN(backupId)) {
      toast.error(t("servers:backups.toasts.invalidId"));
      return;
    }

    const next = !backup.protected;

    setProtectingKey(backupRowKey(backup));
    setIsActionLoading(true);

    try {
      const response = await updateBackup({
        path: {
          server_id: serverId,
          backup_storage: backup.storage,
          backup_id: backupId,
        },
        query: { protected: next },
      });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers:backups.toasts.protectFailed"),
          ),
        );
        return;
      }

      toast.success(
        next
          ? t("servers:backups.toasts.protectSuccess")
          : t("servers:backups.toasts.unprotectSuccess"),
      );
      await refresh();
    } finally {
      setIsActionLoading(false);
      setProtectingKey(null);
    }
  };

  const handleRestore = async () => {
    await withSelectedBackup("restore", async (backup, backupId) => {
      const response = await restoreBackup({
        path: {
          server_id: serverId,
          backup_storage: backup.storage,
          backup_id: backupId,
        },
      });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers:backups.toasts.restoreFailed"),
          ),
        );
        return;
      }

      toast.success(t("servers:backups.toasts.restoreSuccess"));
    });
  };

  const handleDelete = async () => {
    await withSelectedBackup("delete", async (backup, backupId) => {
      const response = await deleteBackup({
        path: {
          server_id: serverId,
          backup_storage: backup.storage,
          backup_id: backupId,
        },
      });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("servers:backups.toasts.deleteFailed"),
          ),
        );
        return;
      }

      toast.success(t("servers:backups.toasts.deleteSuccess"));
      setSelectedBackup(null);
    });
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>{t("common:nav.backups")}</CardTitle>
          <CardDescription>{t("servers:backups.description")}</CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={isActionLoading || storageLock.locked}
          >
            <HardDrive className="size-4" />
            {t("servers:backups.createButton")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refresh();
            }}
            disabled={isActionLoading || storageLock.locked}
          >
            <RefreshCcw className="size-4" />
            {t("common:actions.refresh")}
          </Button>
          <TaskLockNotice lock={restoreLock} />
        </div>

        {backupLimit === null || backupLimit === 0 ? null : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {t("servers:backups.limit.label", {
                  used: backups.length,
                  limit: backupLimit,
                })}
              </span>

              {canBypassLimits ? (
                <Tooltip>
                  <TooltipTrigger
                    render={<Badge variant="secondary" className="gap-1.5" />}
                  >
                    <ShieldCheck className="size-3.5" />
                    {t("servers:backups.limit.bypassBadge")}
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("servers:backups.limit.bypassTooltip")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>

            <Progress
              value={backupLimitPercent}
              className={
                atBackupLimit
                  ? "bg-destructive/20 [&_[data-slot=progress-indicator]]:bg-destructive"
                  : undefined
              }
            />

            {atBackupLimit && !canBypassLimits ? (
              <p className="text-xs text-destructive">
                {t("servers:backups.limit.reached")}
              </p>
            ) : null}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("servers:backups.loading")}
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("servers:backups.empty")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>{t("servers:backups.table.storage")}</TableHead>
                  <TableHead>{t("common:labels.size")}</TableHead>
                  <TableHead>{t("common:labels.created")}</TableHead>
                  <TableHead className="text-right">
                    {t("common:labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((backup) => {
                  const backupId = backupIdFromRow(backup);

                  return (
                    <TableRow key={backupRowKey(backup)}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {backup.protected ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                                }
                              />
                              <TooltipContent>
                                {t("servers:backups.protectedTooltip")}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          {backup.name?.trim() ||
                            t("servers:backups.unnamedBackup", {
                              id: backupId,
                            })}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {backup.storage}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatBytes(backup.size, t("common:status.unknown"))}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(backup.time, t("common:status.unknown"))}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedBackup(backup);
                                    setRenameName(backup.name?.trim() ?? "");
                                    setRenameOpen(true);
                                  }}
                                  disabled={
                                    isActionLoading || storageLock.locked
                                  }
                                  aria-label={t("common:actions.rename")}
                                />
                              }
                            >
                              <Pencil className="size-4" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("common:actions.rename")}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  loading={
                                    protectingKey === backupRowKey(backup)
                                  }
                                  onClick={() => {
                                    void handleToggleProtected(backup);
                                  }}
                                  disabled={
                                    isActionLoading || storageLock.locked
                                  }
                                  aria-label={
                                    backup.protected
                                      ? t("servers:backups.unprotectAction")
                                      : t("servers:backups.protectAction")
                                  }
                                />
                              }
                            >
                              {backup.protected ? (
                                <Lock className="size-4" />
                              ) : (
                                <LockOpen className="size-4" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {backup.protected
                                ? t("servers:backups.unprotectAction")
                                : t("servers:backups.protectAction")}
                            </TooltipContent>
                          </Tooltip>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void handleDownload(backup);
                            }}
                            disabled={isActionLoading || storageLock.locked}
                          >
                            <Download className="size-4" />
                            {t("common:actions.download")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedBackup(backup);
                              setRestoreOpen(true);
                            }}
                            disabled={isActionLoading || restoreLock.locked}
                          >
                            <RotateCcw className="size-4" />
                            {t("servers:backups.restoreButton")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setSelectedBackup(backup);
                              setDeleteOpen(true);
                            }}
                            disabled={isActionLoading || storageLock.locked}
                          >
                            <Trash2 className="size-4" />
                            {t("common:actions.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("servers:backups.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("servers:backups.createDialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="backup-name">
              {t("servers:backups.createDialog.nameLabel")}
            </Label>
            <Input
              id="backup-name"
              value={createName}
              maxLength={64}
              autoComplete="off"
              placeholder={t("servers:backups.createDialog.namePlaceholder")}
              onChange={(event) => setCreateName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("servers:backups.createDialog.nameHelp")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreateBackup();
              }}
              loading={isActionLoading}
              disabled={storageLock.locked}
            >
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) {
            setRenameName("");
            setSelectedBackup(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("servers:backups.renameDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("servers:backups.renameDialog.description", {
                name:
                  selectedBackup?.name?.trim() ||
                  t("servers:backups.unnamedFallback"),
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="backup-rename">{t("common:labels.name")}</Label>
            <Input
              id="backup-rename"
              value={renameName}
              maxLength={64}
              autoComplete="off"
              placeholder={t("servers:backups.createDialog.namePlaceholder")}
              onChange={(event) => setRenameName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("servers:backups.renameDialog.nameHelp")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleRename();
              }}
              loading={isActionLoading}
              disabled={storageLock.locked}
            >
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={restoreOpen}
        onOpenChange={(open) => {
          setRestoreOpen(open);
          if (!open) {
            setSelectedBackup(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers:backups.restoreDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers:backups.restoreDialog.description", {
                name:
                  selectedBackup?.name?.trim() ||
                  t("servers:backups.unnamedFallback"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <TaskLockNotice lock={restoreLock} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
              disabled={isActionLoading || restoreLock.locked}
            >
              {t("servers:backups.restoreButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setSelectedBackup(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers:backups.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers:backups.deleteDialog.description", {
                name:
                  selectedBackup?.name?.trim() ||
                  t("servers:backups.unnamedFallback"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading || storageLock.locked}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
