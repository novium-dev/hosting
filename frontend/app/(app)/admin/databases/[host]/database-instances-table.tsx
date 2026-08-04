"use client";

import { useState } from "react";
import { Boxes, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

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

export type DatabaseInstanceRow = ListDatabaseInstancesResponses[200][number];

function stateBadge(instance: DatabaseInstanceRow) {
  if (!instance.remote) return <Badge variant="destructive">Unreachable</Badge>;
  if (instance.remote.suspended)
    return <Badge variant="destructive">Suspended</Badge>;

  const state = instance.remote.utilization?.state;
  if (state === "running") return <Badge>Running</Badge>;

  return <Badge variant="secondary">{state ?? "Offline"}</Badge>;
}

function formatMib(value: number | null | undefined) {
  if (!value) return "—";
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${value} MiB`;
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
          response.error.error?.msg ?? "Failed to delete the instance",
        );
        return;
      }

      toast.success("Instance deleted");
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
            Database hosts
          </Link>
        </p>
        <h1 className="text-xl font-semibold">{hostName}</h1>
        <p className="text-sm text-muted-foreground">
          Projects create their own instances here. Renaming one and changing its
          limits is an admin job.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Engine</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Memory</TableHead>
              <TableHead>Disk</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Boxes className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No instances yet</p>
                    <p className="text-sm text-muted-foreground">
                      They appear here once a project creates one.
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
                  <TableCell>{stateBadge(instance)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatMib(instance.remote?.memory)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatMib(instance.remote?.disk)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(instance)}
                          aria-label="Edit instance"
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(instance)}
                          aria-label="Delete instance"
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
            <AlertDialogTitle>Delete {deleting?.display}?</AlertDialogTitle>
            <AlertDialogDescription>
              This belongs to {deleting?.project_slug}. The container, every
              database and user on it, and all of their data are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isDeletePending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
