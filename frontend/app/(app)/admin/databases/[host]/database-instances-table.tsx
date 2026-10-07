"use client";

import { useState } from "react";
import { Boxes, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import Link from "@/components/link";
import { DATABASE_TYPE_LABELS } from "@/components/databases/database-type";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteDatabaseInstance,
  type ListDatabaseInstancesResponses,
} from "@/lib/api";
import { EditInstanceDialog } from "./edit-instance-dialog";
import { formatOptionalMib } from "@/lib/format";

export type DatabaseInstanceRow = ListDatabaseInstancesResponses[200][number];

function stateBadge(instance: DatabaseInstanceRow, t: TFunction) {
  if (!instance.remote)
    return (
      <Badge variant="destructive">
        {t("admin-infra:databases.instancesTable.status.unreachable")}
      </Badge>
    );
  if (instance.remote.suspended)
    return <Badge variant="destructive">{t("common:status.suspended")}</Badge>;

  const state = instance.remote.utilization?.state;
  if (state === "running") return <Badge>{t("common:status.running")}</Badge>;

  return (
    <Badge variant="secondary">{state ?? t("common:status.offline")}</Badge>
  );
}

export function DatabaseInstancesTable({
  hostId,
  hostName,
  instances,
  canManage,
  onChanged,
}: {
  hostId: string;
  hostName: string;
  instances: DatabaseInstanceRow[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<DatabaseInstanceRow | null>(null);
  const [deleting, setDeleting] = useState<DatabaseInstanceRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeletePending(true);
    try {
      const response = await deleteDatabaseInstance({
        path: { host_id: hostId, instance_id: deleting.id },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:databases.instancesTable.deleteError"),
        );
        return;
      }

      toast.success(t("admin-infra:databases.instancesTable.deleteSuccess"));
      setDeleting(null);
      onChanged();
    } finally {
      setIsDeletePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/admin/databases" className="hover:underline">
            {t("admin-infra:databases.instancesTable.breadcrumb")}
          </Link>
        </p>
        <h1 className="text-xl font-semibold">{hostName}</h1>
        <p className="text-sm text-muted-foreground">
          {t("admin-infra:databases.instancesTable.description")}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("common:labels.name")}</TableHead>
              <TableHead>
                {t("admin-infra:databases.instancesTable.columns.project")}
              </TableHead>
              <TableHead>
                {t("admin-infra:databases.instancesTable.columns.engine")}
              </TableHead>
              <TableHead>{t("common:labels.status")}</TableHead>
              <TableHead>{t("common:resources.memory")}</TableHead>
              <TableHead>{t("common:resources.disk")}</TableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Boxes className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t(
                        "admin-infra:databases.instancesTable.emptyState.title",
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "admin-infra:databases.instancesTable.emptyState.description",
                      )}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              instances.map((instance) => (
                <TableRow key={instance.id}>
                  <TableCell className="font-medium">
                    {instance.display}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${instance.project_slug}`}
                      className="hover:underline"
                    >
                      {instance.project_slug}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {DATABASE_TYPE_LABELS[instance.type]}
                    </Badge>
                  </TableCell>
                  <TableCell>{stateBadge(instance, t)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatOptionalMib(instance.remote?.memory)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatOptionalMib(instance.remote?.disk)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(instance)}
                          aria-label={t(
                            "admin-infra:databases.instancesTable.editAria",
                          )}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(instance)}
                          aria-label={t(
                            "admin-infra:databases.instancesTable.deleteAria",
                          )}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EditInstanceDialog
        hostId={hostId}
        instance={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={onChanged}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:confirmDelete.title", { name: deleting?.display })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:databases.instancesTable.deleteDescription", {
                project: deleting?.project_slug,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isDeletePending}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
