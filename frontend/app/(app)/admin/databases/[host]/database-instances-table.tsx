"use client";

import { useState } from "react";
import { Boxes, PlusIcon, Trash2Icon } from "lucide-react";
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
import { CreateInstanceDialog } from "./create-instance-dialog";

export type DatabaseInstanceRow =
  ListDatabaseInstancesResponses[200][number];

function stateBadge(instance: DatabaseInstanceRow) {
  const state = instance.remote?.utilization?.state;

  if (!instance.remote) return <Badge variant="destructive">Unreachable</Badge>;
  if (state === "running") return <Badge>Running</Badge>;

  return <Badge variant="secondary">{state ?? "Offline"}</Badge>;
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
  const [creating, setCreating] = useState(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/databases" className="hover:underline">
              Database hosts
            </Link>
          </p>
          <h1 className="text-xl font-semibold">{hostName}</h1>
          <p className="text-sm text-muted-foreground">
            Each instance is one database engine in a container. Project
            databases are placed on an instance of the engine they asked for.
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            Create instance
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Engine</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Databases</TableHead>
              <TableHead>Memory</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {instances.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Boxes className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No instances yet</p>
                    <p className="text-sm text-muted-foreground">
                      Create one per engine you want to offer on this host.
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
                    <Badge variant="secondary">
                      {DATABASE_TYPE_LABELS[instance.type]}
                    </Badge>
                  </TableCell>
                  <TableCell>{stateBadge(instance)}</TableCell>
                  <TableCell>{instance.database_count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {instance.remote?.memory
                      ? `${instance.remote.memory} MiB`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(instance)}
                        aria-label="Delete instance"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateInstanceDialog
        hostId={hostId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={onChanged}
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
              The container and all of its data are removed from the host. It
              must have no project databases left on it.
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
