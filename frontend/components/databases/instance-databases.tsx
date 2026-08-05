"use client";

import useSWR from "swr";

import { createDatabaseAction, deleteDatabaseAction } from "@/actions/databases";
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
import {
  listInstanceDatabases,
  type ListInstanceDatabasesResponses,
} from "@/lib/api";
import { Plus, Table2, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type ProjectDatabase = ListInstanceDatabasesResponses[200][number];

export function InstanceDatabases({
  projectId,
  instanceId,
  canManage,
  onChanged,
}: {
  projectId: string;
  instanceId: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectDatabase | null>(
    null,
  );

  const { data, error, isLoading, mutate } = useSWR(
    ["project-databases", projectId, instanceId],
    async () => {
      const response = await listInstanceDatabases({
        path: { project_id: projectId, instance_id: instanceId },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load databases");
      }
      return response.data ?? [];
    },
  );

  const refresh = () => {
    void mutate();
    onChanged?.();
  };

  const create = useAction(createDatabaseAction, {
    onSuccess: () => {
      toast.success(t("org:databases.databasesCard.created"));
      setCreating(false);
      setName("");
      refresh();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.databasesCard.createError"),
      );
    },
  });

  const remove = useAction(deleteDatabaseAction, {
    onSuccess: () => {
      toast.success(t("org:databases.databasesCard.deleted"));
      setPendingDelete(null);
      refresh();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.databasesCard.deleteError"),
      );
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>{t("common:nav.databases")}</CardTitle>
            <CardDescription>
              {t("org:databases.databasesCard.description")}
            </CardDescription>
          </div>

          {canManage ? (
            <div>
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {t("org:databases.databasesCard.createTrigger")}
              </Button>
            </div>
          ) : null}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">
              {t("org:databases.databasesCard.loadError")}
            </p>
          ) : !data?.length ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <Table2 className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("org:databases.databasesCard.emptyTitle")}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.name")}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((database) => (
                    <TableRow key={database.uuid}>
                      <TableCell className="font-mono text-sm">
                        {database.name}
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPendingDelete(database)}
                            aria-label={t(
                              "org:databases.databasesCard.deleteAriaLabel",
                            )}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("org:databases.databasesCard.createDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("org:databases.databasesCard.createDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="database-name">{t("common:labels.name")}</Label>
            <Input
              id="database-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("org:databases.databasesCard.namePlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={name.trim() === ""}
              loading={create.isExecuting}
              onClick={() =>
                void create.executeAsync({ projectId, instanceId, name })
              }
            >
              {t("org:databases.databasesCard.createSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {t("org:databases.databasesCard.deleteDescription")}
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
                  instanceId,
                  databaseId: pendingDelete.uuid,
                });
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
