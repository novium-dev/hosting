"use client";

import {
  deleteInstanceAction,
  powerInstanceAction,
} from "@/actions/databases";
import Link from "@/components/link";
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
  DropdownMenuSeparator,
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
import type { ListProjectInstancesResponses } from "@/lib/api";
import { Database, MoreHorizontal, Play, RotateCw, Square } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { DATABASE_TYPE_LABELS } from "./database-type";

export type ProjectInstance = ListProjectInstancesResponses[200][number];

interface InstancesTableProps {
  projectId: string;
  slug: string;
  instances: ProjectInstance[] | undefined;
  isLoading?: boolean;
  error?: boolean;
  canManage: boolean;
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

function formatMib(value: number | null | undefined) {
  if (!value) return "—";
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${value} MiB`;
}

export function InstancesTable({
  projectId,
  slug,
  instances,
  isLoading = false,
  error = false,
  canManage,
  onChanged,
}: InstancesTableProps) {
  const { t } = useTranslation();
  const [pendingDelete, setPendingDelete] = useState<ProjectInstance | null>(
    null,
  );

  const power = useAction(powerInstanceAction, {
    onSuccess: () => {
      toast.success(t("org:databases.instancesTable.powerChanged"));
      onChanged();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.managementBar.powerError"),
      );
    },
  });

  const remove = useAction(deleteInstanceAction, {
    onSuccess: () => {
      toast.success(t("org:databases.instancesTable.deleted"));
      setPendingDelete(null);
      onChanged();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.instancesTable.deleteError"),
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
        {t("org:databases.instancesTable.loadError")}
      </p>
    );
  }

  if (!instances?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <Database className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {t("org:databases.instancesTable.emptyTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("org:databases.instancesTable.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("common:labels.name")}</TableHead>
              <TableHead>{t("org:databases.engineLabel")}</TableHead>
              <TableHead>{t("org:databases.instancesTable.stateColumn")}</TableHead>
              <TableHead>{t("common:labels.address")}</TableHead>
              <TableHead>{t("org:shared.memory")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.map((instance) => (
              <TableRow key={instance.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/${slug}/databases/${instance.id}`}
                    className="hover:underline"
                  >
                    {instance.display}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {DATABASE_TYPE_LABELS[instance.type]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StateBadge instance={instance} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {instance.host}:{instance.port}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatMib(instance.memory_limit)}
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() =>
                            void power.executeAsync({
                              projectId,
                              instanceId: instance.id,
                              action: "start",
                            })
                          }
                        >
                          <Play className="size-4" />
                          {t("org:databases.managementBar.start")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void power.executeAsync({
                              projectId,
                              instanceId: instance.id,
                              action: "restart",
                            })
                          }
                        >
                          <RotateCw className="size-4" />
                          {t("org:databases.managementBar.restart")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void power.executeAsync({
                              projectId,
                              instanceId: instance.id,
                              action: "stop",
                            })
                          }
                        >
                          <Square className="size-4" />
                          {t("org:databases.managementBar.stop")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingDelete(instance)}
                        >
                          {t("common:actions.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
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
          <AlertDialogTitle>
            {t("common:confirmDelete.title", { name: pendingDelete?.display })}
          </AlertDialogTitle>
          <AlertDialogHeader>
            <AlertDialogDescription>
              {t("org:databases.instancesTable.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDelete) return;
                void remove.executeAsync({
                  projectId,
                  instanceId: pendingDelete.id,
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
