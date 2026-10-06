"use client";

import useSWR from "swr";

import {
  createUserAction,
  deleteUserAction,
  rotateUserPasswordAction,
  setUserGrantsAction,
} from "@/actions/databases";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  DatabaseAccessMatrix,
  accessToGrants,
  grantsToAccess,
  type AccessMap,
} from "@/components/databases/database-access";
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
import { useInstanceDatabases } from "@/hooks/use-shared-queries";
import { useAction } from "@/lib/action-hooks";
import {
  listInstanceUsers,
  type ListInstanceUsersResponses,
} from "@/lib/api";
import { Copy, Eye, EyeOff, MoreHorizontal, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type ProjectUser = ListInstanceUsersResponses[200][number];

async function copyValue(value: string, successMessage: string, errorMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error(errorMessage);
  }
}

function ConnectionCell({ user }: { user: ProjectUser }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
        {revealed
          ? user.uri
          : user.uri.replace(user.password, "•".repeat(12))}
      </code>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setRevealed((current) => !current)}
        aria-label={
          revealed
            ? t("project:databases.usersCard.hidePassword")
            : t("project:databases.usersCard.revealPassword")
        }
      >
        {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() =>
          void copyValue(
            user.uri,
            t("project:databases.usersCard.connectionUriCopied"),
            t("project:databases.usersCard.connectionUriCopyFailed"),
          )
        }
        aria-label={t("project:databases.usersCard.copyUriAriaLabel")}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function GrantsCell({
  user,
  databases,
}: {
  user: ProjectUser;
  databases: { uuid: string; name: string }[];
}) {
  const { t } = useTranslation();

  if (!user.grants.length) {
    return (
      <span className="text-xs text-muted-foreground">
        {t("project:databases.usersCard.accessNone")}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {user.grants.map((grant) => (
        <Badge
          key={grant.database_uuid}
          variant="secondary"
          className="gap-1 font-mono text-xs"
        >
          {databases.find((database) => database.uuid === grant.database_uuid)
            ?.name ?? grant.database_uuid}
          <span className="text-muted-foreground">
            {grant.access === "write"
              ? t("project:databases.usersCard.accessWriteShort")
              : t("project:databases.usersCard.accessReadShort")}
          </span>
        </Badge>
      ))}
    </div>
  );
}

export function InstanceUsers({
  projectId,
  instanceId,
  canManage,
}: {
  projectId: string;
  instanceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [access, setAccess] = useState<AccessMap>({});
  const [editing, setEditing] = useState<ProjectUser | null>(null);
  const [editingAccess, setEditingAccess] = useState<AccessMap>({});
  const [pendingDelete, setPendingDelete] = useState<ProjectUser | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["instance-users", projectId, instanceId],
    async () => {
      const response = await listInstanceUsers({
        path: { project_id: projectId, instance_id: instanceId },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load users");
      }
      return response.data ?? [];
    },
  );

  const { data: databases } = useInstanceDatabases(projectId, instanceId);

  const create = useAction(createUserAction, {
    onSuccess: () => {
      toast.success(t("project:databases.usersCard.created"));
      setCreating(false);
      setUsername("");
      setAccess({});
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("project:databases.usersCard.createError"),
      );
    },
  });

  const remove = useAction(deleteUserAction, {
    onSuccess: () => {
      toast.success(t("project:databases.usersCard.deleted"));
      setPendingDelete(null);
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("project:databases.usersCard.deleteError"),
      );
    },
  });

  const updateGrants = useAction(setUserGrantsAction, {
    onSuccess: () => {
      toast.success(t("project:databases.usersCard.accessUpdated"));
      setEditing(null);
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("project:databases.usersCard.accessError"),
      );
    },
  });

  const rotate = useAction(rotateUserPasswordAction, {
    onSuccess: () => {
      toast.success(t("project:databases.usersCard.passwordRotated"));
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("project:databases.usersCard.rotateError"),
      );
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>{t("common:nav.users")}</CardTitle>
            <CardDescription>
              {t("project:databases.usersCard.description")}
            </CardDescription>
          </div>

          {canManage ? (
            <div>
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {t("project:databases.usersCard.createTrigger")}
              </Button>
            </div>
          ) : null}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">
              {t("project:databases.usersCard.loadError")}
            </p>
          ) : !data?.length ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <UserRound className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("project:databases.usersCard.emptyTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("project:databases.usersCard.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:resources.username")}</TableHead>
                    <TableHead>{t("project:databases.usersCard.accessColumn")}</TableHead>
                    <TableHead>{t("project:databases.usersCard.connectionColumn")}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((user) => (
                    <TableRow key={user.uuid}>
                      <TableCell className="font-mono text-xs">
                        {user.identifier}
                      </TableCell>
                      <TableCell>
                        <GrantsCell user={user} databases={databases ?? []} />
                      </TableCell>
                      <TableCell className="max-w-md">
                        <ConnectionCell user={user} />
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
                                onSelect={() => {
                                  setEditing(user);
                                  setEditingAccess(grantsToAccess(user.grants));
                                }}
                              >
                                {t("project:databases.usersCard.manageAccess")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  void rotate.executeAsync({
                                    projectId,
                                    instanceId,
                                    userId: user.uuid,
                                  })
                                }
                              >
                                {t("project:databases.usersCard.rotatePassword")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setPendingDelete(user)}
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
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("project:databases.usersCard.createDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("project:databases.usersCard.createDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">
                {t("common:resources.username")}
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("project:databases.usersCard.usernamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("project:databases.usersCard.grantOnLabel")}</Label>
              <DatabaseAccessMatrix
                databases={databases ?? []}
                value={access}
                onChange={setAccess}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={username.trim().length < 2}
              loading={create.isExecuting}
              onClick={() =>
                void create.executeAsync({
                  projectId,
                  instanceId,
                  username,
                  grants: accessToGrants(access),
                })
              }
            >
              {t("project:databases.usersCard.createSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("project:databases.usersCard.accessDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("project:databases.usersCard.accessDialogDescription", {
                name: editing?.identifier,
              })}
            </DialogDescription>
          </DialogHeader>
          <DatabaseAccessMatrix
            databases={databases ?? []}
            value={editingAccess}
            onChange={setEditingAccess}
            disabled={updateGrants.isExecuting}
          />
          <DialogFooter>
            <Button
              type="button"
              loading={updateGrants.isExecuting}
              onClick={() => {
                if (!editing) return;
                void updateGrants.executeAsync({
                  projectId,
                  instanceId,
                  userId: editing.uuid,
                  grants: accessToGrants(editingAccess),
                });
              }}
            >
              {t("common:actions.save")}
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
              {t("common:confirmDelete.title", {
                name: pendingDelete?.identifier,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:databases.usersCard.deleteDescription")}
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
                  userId: pendingDelete.uuid,
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
