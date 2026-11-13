"use client";

import {
  Download,
  Lock,
  LockOpen,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useSWR from "swr";

import { CronEditor } from "@/app/(app)/[slug]/servers/[server]/components/schedules/cron-editor";
import {
  DEFAULT_CRON,
  DEFAULT_RETENTION,
  RETENTION_FIELDS,
  localTimezone,
  retentionCeiling,
  timezones,
} from "@/app/(app)/[slug]/servers/[server]/components/schedules/utils";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createDatabaseBackup,
  deleteDatabaseBackup,
  deleteDatabaseBackupJob,
  listDatabaseBackups,
  restoreDatabaseBackup,
  setDatabaseBackupJob,
  updateDatabaseBackup,
  type BackupRetention,
  type ListDatabaseBackupsResponses,
  type StoredBackup,
} from "@/lib/api";
import { client } from "@/lib/api/client.gen";
import { apiErrorMessage } from "@/lib/api-error";

type BackupList = ListDatabaseBackupsResponses[200];
type BackupJob = NonNullable<BackupList["job"]>;

type DatabaseRef = {
  uuid: string;
  name: string;
};

const RUNNING_REFRESH = 3000;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(2)} ${unit}`;
}

function formatDate(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function DatabaseBackupsDialog({
  projectId,
  instanceId,
  database,
  canManage,
  onOpenChange,
}: {
  projectId: string;
  instanceId: string;
  database: DatabaseRef | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={database !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("project:databases.backups.title", { name: database?.name })}
          </DialogTitle>
          <DialogDescription>
            {t("project:databases.backups.description")}
          </DialogDescription>
        </DialogHeader>
        {database ? (
          <DatabaseBackups
            key={database.uuid}
            projectId={projectId}
            instanceId={instanceId}
            database={database}
            canManage={canManage}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DatabaseBackups({
  projectId,
  instanceId,
  database,
  canManage,
}: {
  projectId: string;
  instanceId: string;
  database: DatabaseRef;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const path = {
    project_id: projectId,
    instance_id: instanceId,
    database_id: database.uuid,
  };

  const { data, error, isLoading, mutate } = useSWR<BackupList>(
    ["database-backups", projectId, instanceId, database.uuid],
    async () => {
      const response = await listDatabaseBackups({ path });
      if (response.error || !response.data) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("project:databases.backups.loadError"),
          ),
        );
      }
      return response.data;
    },
    {
      refreshInterval: (latest) => (latest?.running ? RUNNING_REFRESH : 0),
    },
  );

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<StoredBackup | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<StoredBackup | null>(null);

  const run = async (
    operation: () => Promise<{ error?: unknown }>,
    success: string,
    failure: string,
  ) => {
    setBusy(true);
    try {
      const response = await operation();
      if (response.error) {
        toast.error(apiErrorMessage(response.error, failure));
        return false;
      }
      toast.success(success);
      await mutate();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    const created = await run(
      () =>
        createDatabaseBackup({
          path,
          query: trimmed.length > 0 ? { name: trimmed } : undefined,
        }),
      t("project:databases.backups.created"),
      t("project:databases.backups.createError"),
    );
    if (created) setName("");
  };

  const toggleProtected = (backup: StoredBackup) =>
    void run(
      () =>
        updateDatabaseBackup({
          path: { ...path, backup_id: backup.time },
          query: { protected: !backup.protected },
        }),
      backup.protected
        ? t("project:databases.backups.unprotected")
        : t("project:databases.backups.protected"),
      t("project:databases.backups.updateError"),
    );

  const downloadUrl = (backup: StoredBackup) =>
    client.buildUrl({
      baseUrl: client.getConfig().baseUrl,
      url: "/project/{project_id}/instance/{instance_id}/database/{database_id}/backup/{backup_id}",
      path: { ...path, backup_id: backup.time },
    });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error
          ? error.message
          : t("project:databases.backups.loadError")}
      </p>
    );
  }

  const disabled = busy || Boolean(data.running);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t("project:databases.backups.usage", {
              count: data.backups.length,
              limit: data.limit,
            })}
          </p>
          {data.running ? (
            <Badge variant="secondary">
              {t(`project:databases.backups.running.${data.running}`)}
            </Badge>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("project:databases.backups.namePlaceholder")}
              aria-label={t("common:labels.name")}
            />
            <Button
              type="button"
              disabled={disabled}
              loading={busy}
              onClick={() => void create()}
            >
              <Plus className="size-4" />
              {t("project:databases.backups.create")}
            </Button>
          </div>
        ) : null}

        {data.backups.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("project:databases.backups.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("project:databases.backups.created_at")}
                  </TableHead>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>{t("project:databases.backups.size")}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.backups.map((backup) => (
                  <TableRow key={backup.time}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(backup.time)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {backup.name ?? (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {backup.protected ? (
                          <Badge variant="outline">
                            {t("project:databases.backups.protectedBadge")}
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatBytes(backup.size)}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("common:actions.download")}
                            render={<a href={downloadUrl(backup)} download />}
                          >
                            <Download className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={
                              backup.protected
                                ? t("project:databases.backups.unprotect")
                                : t("project:databases.backups.protect")
                            }
                            onClick={() => toggleProtected(backup)}
                          >
                            {backup.protected ? (
                              <Lock className="size-4" />
                            ) : (
                              <LockOpen className="size-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            aria-label={t("project:databases.backups.restore")}
                            onClick={() => setPendingRestore(backup)}
                          >
                            <RotateCcw className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={t("common:actions.delete")}
                            onClick={() => setPendingDelete(backup)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Separator />

      <BackupJobEditor
        key={JSON.stringify(data.job ?? null)}
        job={data.job ?? null}
        limit={data.limit}
        canManage={canManage}
        onSave={(body) =>
          run(
            () => setDatabaseBackupJob({ path, body }),
            t("project:databases.backups.job.saved"),
            t("project:databases.backups.job.saveError"),
          )
        }
        onRemove={() =>
          run(
            () => deleteDatabaseBackupJob({ path }),
            t("project:databases.backups.job.removed"),
            t("project:databases.backups.job.removeError"),
          )
        }
        busy={busy}
      />

      <AlertDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("project:databases.backups.restoreTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:databases.backups.restoreDescription", {
                name: database.name,
                date: formatDate(pendingRestore?.time),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRestore) return;
                const backupId = pendingRestore.time;
                setPendingRestore(null);
                void run(
                  () =>
                    restoreDatabaseBackup({
                      path: { ...path, backup_id: backupId },
                    }),
                  t("project:databases.backups.restoreStarted"),
                  t("project:databases.backups.restoreError"),
                );
              }}
            >
              {t("project:databases.backups.restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("project:databases.backups.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:databases.backups.deleteDescription", {
                date: formatDate(pendingDelete?.time),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                const backupId = pendingDelete.time;
                setPendingDelete(null);
                void run(
                  () =>
                    deleteDatabaseBackup({
                      path: { ...path, backup_id: backupId },
                    }),
                  t("project:databases.backups.deleted"),
                  t("project:databases.backups.deleteError"),
                );
              }}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackupJobEditor({
  job,
  limit,
  canManage,
  busy,
  onSave,
  onRemove,
}: {
  job: BackupJob | null;
  limit: number;
  canManage: boolean;
  busy: boolean;
  onSave: (body: {
    enabled: boolean;
    cron: string;
    timezone: string;
    retention: BackupRetention;
  }) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [cron, setCron] = useState(() => {
    if (!job) return DEFAULT_CRON;
    const fields = job.cron.trim().split(/\s+/);
    return fields.length === 5 ? ["0", ...fields] : fields;
  });
  const [timezone, setTimezone] = useState(job?.timezone ?? localTimezone());
  const [zones] = useState(timezones);
  const [retention, setRetention] = useState<BackupRetention>(
    job?.retention ?? {
      ...DEFAULT_RETENTION,
      keep_last: Math.min(DEFAULT_RETENTION.keep_last, limit),
    },
  );

  const ceiling = retentionCeiling(retention);
  const retentionValid = ceiling !== null && ceiling <= limit;
  const lastRun = formatDate(job?.last_run);
  const nextRun = formatDate(job?.next_run);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t("project:databases.backups.job.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("project:databases.backups.job.description")}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!canManage}
          aria-label={t("project:databases.backups.job.enabled")}
          onCheckedChange={setEnabled}
        />
      </div>

      {job ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {nextRun && job.enabled ? (
            <span>
              {t("project:databases.backups.job.nextRun", { date: nextRun })}
            </span>
          ) : null}
          {lastRun ? (
            <span>
              {t("project:databases.backups.job.lastRun", { date: lastRun })}
            </span>
          ) : null}
          {job.last_error ? (
            <span className="text-destructive">
              {t(`project:databases.backups.job.errors.${job.last_error}`)}
            </span>
          ) : null}
        </div>
      ) : null}

      {canManage ? (
        <>
          <CronEditor cron={cron} timezone={timezone} onChange={setCron} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="backup-job-timezone">
              {t("servers:schedules.dialog.timezone")}
            </Label>
            <Select
              value={timezone}
              onValueChange={(value) => setTimezone(value ?? "")}
            >
              <SelectTrigger id="backup-job-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {t("servers:schedules.retention.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("project:databases.backups.job.retentionDescription", {
                limit,
              })}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RETENTION_FIELDS.map((field) => (
                <div key={field} className="space-y-1">
                  <Label
                    htmlFor={`backup-job-${field}`}
                    className="text-xs text-muted-foreground"
                  >
                    {t(`servers:schedules.retention.fields.${field}`)}
                  </Label>
                  <Input
                    id={`backup-job-${field}`}
                    type="number"
                    min={0}
                    className="h-8 tabular-nums"
                    value={retention[field]}
                    onChange={(event) =>
                      setRetention({
                        ...retention,
                        [field]: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>
              ))}
            </div>
            {retentionValid ? null : (
              <p className="text-xs text-destructive">
                {t("project:databases.backups.job.retentionInvalid", { limit })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {job ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onRemove()}
              >
                {t("common:actions.remove")}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={busy || !retentionValid || timezone === ""}
              loading={busy}
              onClick={() =>
                void onSave({
                  enabled,
                  cron: cron.map((field) => field.trim()).join(" "),
                  timezone,
                  retention,
                })
              }
            >
              {t("common:actions.save")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
