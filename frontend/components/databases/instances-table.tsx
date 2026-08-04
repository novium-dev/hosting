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
  if (instance.suspended) return <Badge variant="destructive">Suspended</Badge>;

  switch (instance.state) {
    case "running":
      return <Badge>Running</Badge>;
    case "starting":
      return <Badge variant="secondary">Starting</Badge>;
    case "stopping":
      return <Badge variant="secondary">Stopping</Badge>;
    default:
      return <Badge variant="outline">Offline</Badge>;
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
  const [pendingDelete, setPendingDelete] = useState<ProjectInstance | null>(
    null,
  );

  const power = useAction(powerInstanceAction, {
    onSuccess: () => {
      toast.success("Power state changed");
      onChanged();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to change the power state");
    },
  });

  const remove = useAction(deleteInstanceAction, {
    onSuccess: () => {
      toast.success("Instance deleted");
      setPendingDelete(null);
      onChanged();
    },
    onError: (result) => {
      toast.error(result.error.serverError ?? "Failed to delete the instance");
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
      <p className="text-sm text-destructive">Failed to load the instances.</p>
    );
  }

  if (!instances?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <Database className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No database instances yet</p>
        <p className="text-sm text-muted-foreground">
          Create one, then add as many databases and users to it as you need.
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
              <TableHead>Name</TableHead>
              <TableHead>Engine</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Memory</TableHead>
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
                          Start
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
                          Restart
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
                          Stop
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingDelete(instance)}
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete {pendingDelete?.display}?</AlertDialogTitle>
          <AlertDialogHeader>
            <AlertDialogDescription>
              Every database and user on this instance is deleted with it, along
              with all of their data. This cannot be undone.
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
                  instanceId: pendingDelete.id,
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
