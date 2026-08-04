"use client";

import {
  deleteDatabaseAction,
  rotateDatabasePasswordAction,
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
import type { ListProjectDatabasesResponses } from "@/lib/api";
import { useAction } from "@/lib/action-hooks";
import { Copy, Database, Eye, EyeOff, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DATABASE_TYPE_LABELS, hasNamedDatabases } from "./database-type";

export type ProjectDatabase =
  ListProjectDatabasesResponses[200][number];

interface DatabasesTableProps {
  projectId: string;
  databases: ProjectDatabase[] | undefined;
  isLoading?: boolean;
  error?: boolean;
  /** Whether the viewer may delete databases and rotate their passwords. */
  canManage: boolean;
  onChanged: () => void;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Failed to copy the ${label.toLowerCase()}`);
  }
}

function ConnectionRow({ database }: { database: ProjectDatabase }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          Host{" "}
          <span className="font-mono text-foreground">
            {database.host}:{database.port}
          </span>
        </span>
        <span>
          User{" "}
          <span className="font-mono text-foreground">{database.username}</span>
        </span>
        {hasNamedDatabases(database.type) ? (
          <span>
            Database{" "}
            <span className="font-mono text-foreground">
              {database.database}
            </span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {revealed ? database.uri : database.uri.replace(database.password, "•".repeat(12))}
        </code>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? "Hide password" : "Reveal password"}
        >
          {revealed ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void copy(database.uri, "Connection URI")}
          aria-label="Copy connection URI"
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function DatabasesTable({
  projectId,
  databases,
  isLoading = false,
  error = false,
  canManage,
  onChanged,
}: DatabasesTableProps) {
  const [pendingDelete, setPendingDelete] = useState<ProjectDatabase | null>(
    null,
  );

  const deleteDatabase = useAction(deleteDatabaseAction, {
    onSuccess: () => {
      toast.success("Database deleted");
      setPendingDelete(null);
      onChanged();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to delete the database");
    },
  });

  const rotatePassword = useAction(rotateDatabasePasswordAction, {
    onSuccess: () => {
      toast.success("Password rotated");
      onChanged();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to rotate the password");
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
      <p className="text-sm text-destructive">Failed to load the databases.</p>
    );
  }

  if (!databases?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <Database className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No databases yet</p>
        <p className="text-sm text-muted-foreground">
          Create one to get a connection string for your servers.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Engine</TableHead>
            <TableHead>Connection</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {databases.map((database) => (
            <TableRow key={database.id}>
              <TableCell className="font-medium">{database.name}</TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {DATABASE_TYPE_LABELS[database.type]}
                </Badge>
              </TableCell>
              <TableCell className="max-w-md">
                <ConnectionRow database={database} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(database.created)}
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
                          void rotatePassword.executeAsync({
                            projectId,
                            databaseId: database.id,
                          })
                        }
                      >
                        Rotate password
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setPendingDelete(database)}
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The database, its user and everything stored in it are deleted on
              the host. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                void deleteDatabase.executeAsync({
                  projectId,
                  databaseId: pendingDelete.id,
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
