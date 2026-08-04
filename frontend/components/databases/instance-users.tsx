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

export type ProjectUser = ListInstanceUsersResponses[200][number];

const NO_DATABASE = "none";

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Failed to copy the ${label.toLowerCase()}`);
  }
}

function ConnectionCell({ user }: { user: ProjectUser }) {
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
        aria-label={revealed ? "Hide password" : "Reveal password"}
      >
        {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => void copy(user.uri, "Connection URI")}
        aria-label="Copy connection URI"
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
      toast.success("User created");
      setCreating(false);
      setUsername("");
      setDatabase(NO_DATABASE);
      void mutate();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to create the user");
    },
  });

  const remove = useAction(deleteUserAction, {
    onSuccess: () => {
      toast.success("User deleted");
      setPendingDelete(null);
      void mutate();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to delete the user");
    },
  });

  const rotate = useAction(rotateUserPasswordAction, {
    onSuccess: () => {
      toast.success("Password rotated");
      void mutate();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to rotate the password");
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>Users</CardTitle>
            <CardDescription>
              Each one connects with the name shown, which carries its own id.
            </CardDescription>
          </div>

          {canManage ? (
            <div>
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New user
              </Button>
            </div>
          ) : null}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load the users.</p>
          ) : !data?.length ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <UserRound className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No users yet</p>
              <p className="text-sm text-muted-foreground">
                Create one to get a connection string.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Connection</TableHead>
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
                                Rotate password
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setPendingDelete(user)}
                              >
                                Delete
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
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              A password is generated for you and shown once the user exists.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="app"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grant">Grant on</Label>
              <Select value={database} onValueChange={setDatabase}>
                <SelectTrigger id="grant" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DATABASE}>No database</SelectItem>
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
              Create user
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
              Delete {pendingDelete?.identifier}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Anything still connecting with these credentials stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
