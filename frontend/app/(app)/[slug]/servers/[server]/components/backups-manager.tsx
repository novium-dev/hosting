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

function formatBytes(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "Unknown";
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

function formatTime(timestamp: number) {
  const normalized =
    timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

function backupIdFromRow(backup: BackupRow) {
  return Number(backup.time);
}

export function BackupsManager({ serverId }: BackupsManagerProps) {
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
        throw new Error("Failed to load backups");
      }

      const sorted = [...response.data].sort((a, b) => b.time - a.time);
      setBackups(sorted);
    } catch {
      toast.error("Failed to load backups");
    } finally {
      setIsLoading(false);
    }
  }, [serverId]);

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
        toast.error(response.error.error?.msg ?? "Failed to create backup");
        return;
      }

      toast.success("Backup creation started");
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
      toast.error("Invalid backup selection");
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
      toast.error("Invalid backup id");
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
        toast.error(response.error?.error?.msg ?? "Failed to get backup URL");
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
        toast.error(response.error.error?.msg ?? "Failed to restore backup");
        return;
      }

      toast.success("Restore command sent");
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
        toast.error(response.error.error?.msg ?? "Failed to delete backup");
        return;
      }

      toast.success("Backup deleted");
      setSelectedBackup(null);
    });
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Backups</CardTitle>
          <CardDescription>
            Manage server backups, restore points, and downloads.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={isActionLoading}
          >
            <HardDrive className="size-4" />
            Create Backup
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
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading backups...
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No backups found.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((backup) => {
                  const backupId = backupIdFromRow(backup);

                  return (
                    <TableRow key={`${backup.storage}-${backup.time}`}>
                      <TableCell className="font-medium">
                        {backup.name?.trim() || `Backup ${backupId}`}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {backup.storage}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatBytes(backup.size)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(backup.time)}
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
                            Download
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
                            Restore
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
                            Delete
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
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>
              This will start creating a new backup using the default storage.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isActionLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreateBackup();
              }}
              loading={isActionLoading}
            >
              Create
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
            <AlertDialogTitle>Restore backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore{" "}
              {selectedBackup?.name?.trim() || "the selected backup"}. Existing
              data may be overwritten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
              disabled={isActionLoading}
            >
              Restore
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
            <AlertDialogTitle>Delete backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This action permanently removes{" "}
              {selectedBackup?.name?.trim() || "the selected backup"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
