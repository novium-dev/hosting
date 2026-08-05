"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  HardDrive,
  Loader2,
  RefreshCcw,
  RotateCcw,
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
  type ListBackupsResponses,
} from "@/lib/api";

type BackupsManagerProps = {
  serverId: string;
};

type BackupRow = ListBackupsResponses[200][number];

type BackupAction = "download" | "restore" | "delete";

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

export function BackupsManager({ serverId }: BackupsManagerProps) {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupRow | null>(null);

  const selectedBackupId = useMemo(
    () => (selectedBackup ? backupIdFromRow(selectedBackup) : null),
    [selectedBackup],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await listBackups({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error(t("servers:backups.toasts.loadFailed"));
      }

      const sorted = [...response.data].sort((a, b) => b.time - a.time);
      setBackups(sorted);
    } catch {
      toast.error(t("servers:backups.toasts.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [serverId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateBackup = async () => {
    setIsActionLoading(true);

    try {
      const response = await createBackup({
        path: {
          server_id: serverId,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? t("servers:backups.toasts.createFailed"),
        );
        return;
      }

      toast.success(t("servers:backups.toasts.createSuccess"));
      setCreateOpen(false);
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
          response.error?.error?.msg ??
            t("servers:backups.toasts.downloadUrlFailed"),
        );
        return;
      }

      window.open(response.data, "_blank", "noopener,noreferrer");
    } finally {
      setIsActionLoading(false);
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
          response.error.error?.msg ??
            t("servers:backups.toasts.restoreFailed"),
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
          response.error.error?.msg ?? t("servers:backups.toasts.deleteFailed"),
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
            disabled={isActionLoading}
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
            disabled={isActionLoading}
          >
            <RefreshCcw className="size-4" />
            {t("common:actions.refresh")}
          </Button>
        </div>
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
                    <TableRow key={`${backup.storage}-${backup.time}`}>
                      <TableCell className="font-medium">
                        {backup.name?.trim() ||
                          t("servers:backups.unnamedBackup", {
                            id: backupId,
                          })}
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
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void handleDownload(backup);
                            }}
                            disabled={isActionLoading}
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
                            disabled={isActionLoading}
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
                            disabled={isActionLoading}
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
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("servers:backups.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("servers:backups.createDialog.description")}
            </DialogDescription>
          </DialogHeader>
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
            >
              {t("common:actions.create")}
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
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
              disabled={isActionLoading}
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
              disabled={isActionLoading}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
