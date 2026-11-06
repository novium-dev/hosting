"use client";

import { deleteProjectDatabaseAction } from "@/actions/databases";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ProjectDatabaseEntry } from "@/types/api";
import { Database, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { DATABASE_TYPE_LABELS } from "./database-type";

interface ProjectDatabasesTableProps {
  projectId: string;
  slug: string;
  databases: ProjectDatabaseEntry[] | undefined;
  canManage: boolean;
  isLoading?: boolean;
  error?: boolean;
  onChanged: () => void;
}

function StateBadge({ database }: { database: ProjectDatabaseEntry }) {
  const { t } = useTranslation();

  if (database.suspended) {
    return <Badge variant="destructive">{t("common:status.suspended")}</Badge>;
  }

  switch (database.state) {
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

export function ProjectDatabasesTable({
  projectId,
  slug,
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

  if (!databases?.length) {
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

  const instancesPerType = new Map<string, Set<string>>();
  for (const database of databases) {
    const instances = instancesPerType.get(database.type) ?? new Set();
    instances.add(database.instance_id);
    instancesPerType.set(database.type, instances);
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("common:labels.name")}</TableHead>
              <TableHead>{t("project:databases.engineLabel")}</TableHead>
              <TableHead>{t("project:databases.list.stateColumn")}</TableHead>
              <TableHead className="w-full">
                {t("project:databases.list.connectionColumn")}
              </TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {databases.map((database) => {
              const owner = database.users[0];
              const showInstance =
                (instancesPerType.get(database.type)?.size ?? 0) > 1;

              return (
                <TableRow key={`${database.instance_id}/${database.id}`}>
                  <TableCell>
                    <div className="font-medium">{database.name}</div>
                    {showInstance ? (
                      <div className="text-xs text-muted-foreground">
                        {database.instance_display}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {DATABASE_TYPE_LABELS[database.type]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StateBadge database={database} />
                  </TableCell>
                  <TableCell className="max-w-0">
                    {owner ? (
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
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">
                        {database.host}:{database.port}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("project:databases.list.actions")}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            router.push(
                              `/${slug}/databases/${database.instance_id}/users`,
                            )
                          }
                        >
                          {t("project:databases.list.advanced")}
                        </DropdownMenuItem>
                        {canManage ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(database)}
                          >
                            {t("common:actions.delete")}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
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
