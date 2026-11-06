"use client";

import { deleteProjectDatabaseAction } from "@/actions/databases";
import Link from "@/components/link";
import { ConnectionCell } from "@/components/databases/instance-users";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/lib/action-hooks";
import { useRouter } from "@/lib/navigation";
import type { ProjectDatabaseEntry, ProjectInstance } from "@/types/api";
import {
  ChevronRight,
  CornerDownRight,
  Database,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { DATABASE_TYPE_LABELS, hasNamedDatabases } from "./database-type";

interface ProjectDatabasesTableProps {
  projectId: string;
  slug: string;
  instances: ProjectInstance[] | undefined;
  databases: ProjectDatabaseEntry[] | undefined;
  canManage: boolean;
  isLoading?: boolean;
  error?: boolean;
  onChanged: () => void;
}

function StateBadge({ instance }: { instance: ProjectInstance }) {
  const { t } = useTranslation();

  if (instance.suspended) {
    return <Badge variant="destructive">{t("common:status.suspended")}</Badge>;
  }

  switch (instance.state) {
    case "running":
      return <Badge>{t("common:status.running")}</Badge>;
    case "starting":
      return <Badge variant="secondary">{t("common:status.starting")}</Badge>;
    case "stopping":
      return <Badge variant="secondary">{t("common:status.stopping")}</Badge>;
    default:
      return <Badge variant="outline">{t("common:status.offline")}</Badge>;
  }
}

function UsersCell({ database }: { database: ProjectDatabaseEntry }) {
  const { t } = useTranslation();
  const owner = database.users[0];

  if (!owner) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("project:databases.list.noUsers")}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <ConnectionCell user={owner} />
      </div>
      {database.users.length > 1 ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("project:databases.list.moreUsers", {
            count: database.users.length - 1,
          })}
        </span>
      ) : null}
    </div>
  );
}

export function ProjectDatabasesTable({
  projectId,
  slug,
  instances,
  databases,
  canManage,
  isLoading = false,
  error = false,
  onChanged,
}: ProjectDatabasesTableProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pendingDelete, setPendingDelete] =
    useState<ProjectDatabaseEntry | null>(null);

  const remove = useAction(deleteProjectDatabaseAction, {
    onSuccess: () => {
      toast.success(t("project:databases.list.deleted"));
      setPendingDelete(null);
      onChanged();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("project:databases.list.deleteError"),
      );
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {t("project:databases.list.loadError")}
      </p>
    );
  }

  if (!instances?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <Database className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {t("project:databases.list.emptyTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("project:databases.list.emptyDescription")}
        </p>
      </div>
    );
  }

  const byInstance = new Map<string, ProjectDatabaseEntry[]>();
  for (const database of databases ?? []) {
    const entries = byInstance.get(database.instance_id) ?? [];
    entries.push(database);
    byInstance.set(database.instance_id, entries);
  }

  const instancesPerType = new Map<string, number>();
  for (const instance of instances) {
    instancesPerType.set(
      instance.type,
      (instancesPerType.get(instance.type) ?? 0) + 1,
    );
  }

  const deleteButton = (database: ProjectDatabaseEntry) =>
    canManage ? (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          setPendingDelete(database);
        }}
        aria-label={t("common:actions.delete")}
        title={t("common:actions.delete")}
      >
        <Trash2Icon className="size-4" />
      </Button>
    ) : null;

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("common:labels.name")}</TableHead>
              <TableHead>{t("project:databases.list.stateColumn")}</TableHead>
              <TableHead className="w-full">
                {t("project:databases.list.connectionColumn")}
              </TableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.flatMap((instance) => {
              const href = `/${slug}/databases/${instance.id}`;
              const children = byInstance.get(instance.id) ?? [];
              const named = hasNamedDatabases(instance.type);
              const unnamedEntry = named ? undefined : children[0];
              const showDisplay =
                (instancesPerType.get(instance.type) ?? 0) > 1;

              const instanceRow = (
                <TableRow
                  key={instance.id}
                  className="cursor-pointer"
                  onClick={() => router.push(href)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Database className="size-4 shrink-0 text-muted-foreground" />
                      <Link
                        href={href}
                        className="font-medium underline-offset-4 hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {DATABASE_TYPE_LABELS[instance.type]}
                      </Link>
                      {showDisplay || !named ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {instance.display}
                        </span>
                      ) : null}
                      {named ? (
                        <Badge variant="secondary" className="text-xs">
                          {t("project:databases.list.databaseCount", {
                            count: children.length,
                          })}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StateBadge instance={instance} />
                  </TableCell>
                  <TableCell
                    className="max-w-0"
                    onClick={(event) => {
                      if (unnamedEntry) event.stopPropagation();
                    }}
                  >
                    {unnamedEntry ? (
                      <UsersCell database={unnamedEntry} />
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {instance.host}:{instance.port}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {unnamedEntry ? deleteButton(unnamedEntry) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        render={<Link href={href} />}
                        nativeButton={false}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={t("project:databases.list.openInstance")}
                        title={t("project:databases.list.openInstance")}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );

              if (!named) return [instanceRow];

              return [
                instanceRow,
                ...children.map((database) => (
                  <TableRow key={`${instance.id}/${database.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 pl-6">
                        <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{database.name}</span>
                      </div>
                    </TableCell>
                    <TableCell />
                    <TableCell className="max-w-0">
                      <UsersCell database={database} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {deleteButton(database)}
                      </div>
                    </TableCell>
                  </TableRow>
                )),
              ];
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:confirmDelete.title", { name: pendingDelete?.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:databases.list.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                void remove.executeAsync({
                  projectId,
                  instanceId: pendingDelete.instance_id,
                  databaseId: pendingDelete.id,
                });
              }}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
