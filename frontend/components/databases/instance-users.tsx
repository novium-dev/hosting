"use client";

import useSWR from "swr";

import {
  createUserAction,
  deleteUserAction,
  rotateUserPasswordAction,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  listInstanceUsers,
  type ListInstanceUsersResponses,
} from "@/lib/api";
import { Copy, Eye, EyeOff, MoreHorizontal, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type ProjectUser = ListInstanceUsersResponses[200][number];

const NO_DATABASE = "none";

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
            ? t("org:databases.usersCard.hidePassword")
            : t("org:databases.usersCard.revealPassword")
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
            t("org:databases.usersCard.connectionUriCopied"),
            t("org:databases.usersCard.connectionUriCopyFailed"),
          )
        }
        aria-label={t("org:databases.usersCard.copyUriAriaLabel")}
      >
        <Copy className="size-4" />
      </Button>
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
  const [database, setDatabase] = useState(NO_DATABASE);
  const [pendingDelete, setPendingDelete] = useState<ProjectUser | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    ["project-users", projectId, instanceId],
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

  const { data: databases } = useSWR(
    ["project-databases", projectId, instanceId],
    async () => {
      const response = await listInstanceDatabases({
        path: { project_id: projectId, instance_id: instanceId },
      });
      return response.error ? [] : (response.data ?? []);
    },
  );

  const create = useAction(createUserAction, {
    onSuccess: () => {
      toast.success(t("org:databases.usersCard.created"));
      setCreating(false);
      setUsername("");
      setDatabase(NO_DATABASE);
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.usersCard.createError"),
      );
    },
  });

  const remove = useAction(deleteUserAction, {
    onSuccess: () => {
      toast.success(t("org:databases.usersCard.deleted"));
      setPendingDelete(null);
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.usersCard.deleteError"),
      );
    },
  });

  const rotate = useAction(rotateUserPasswordAction, {
    onSuccess: () => {
      toast.success(t("org:databases.usersCard.passwordRotated"));
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? t("org:databases.usersCard.rotateError"),
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
              {t("org:databases.usersCard.description")}
            </CardDescription>
          </div>

          {canManage ? (
            <div>
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {t("org:databases.usersCard.createTrigger")}
              </Button>
            </div>
          ) : null}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">
              {t("org:databases.usersCard.loadError")}
            </p>
          ) : !data?.length ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <UserRound className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("org:databases.usersCard.emptyTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("org:databases.usersCard.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:resources.username")}</TableHead>
                    <TableHead>{t("org:databases.usersCard.connectionColumn")}</TableHead>
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((user) => (
                    <TableRow key={user.uuid}>
                      <TableCell className="font-mono text-xs">
                        {user.identifier}
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
                                onSelect={() =>
                                  void rotate.executeAsync({
                                    projectId,
                                    instanceId,
                                    userId: user.uuid,
                                  })
                                }
                              >
                                {t("org:databases.usersCard.rotatePassword")}
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
            <DialogTitle>{t("org:databases.usersCard.createDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("org:databases.usersCard.createDialogDescription")}
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
                placeholder={t("org:databases.usersCard.usernamePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant">
                {t("org:databases.usersCard.grantOnLabel")}
              </Label>
              <Select value={database} onValueChange={setDatabase}>
                <SelectTrigger id="grant" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DATABASE}>
                    {t("org:databases.usersCard.noDatabaseOption")}
                  </SelectItem>
                  {(databases ?? []).map((option) => (
                    <SelectItem key={option.uuid} value={option.uuid}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  database: database === NO_DATABASE ? undefined : database,
                })
              }
            >
              {t("org:databases.usersCard.createSubmit")}
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
              {t("org:databases.usersCard.deleteDescription")}
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
