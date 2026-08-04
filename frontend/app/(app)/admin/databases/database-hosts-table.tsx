"use client";

import { useState } from "react";
import { Database, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteDatabaseHost,
  type ListDatabaseHostsResponses,
  type ListRegionsResponses,
} from "@/lib/api";
import { DatabaseHostDialog } from "./database-host-dialog";

export type DatabaseHostRow = ListDatabaseHostsResponses[200][number];
export type RegionRow = ListRegionsResponses[200][number];

export function DatabaseHostsTable({
  hosts,
  regions,
  canManage,
  onChanged,
}: {
  hosts: DatabaseHostRow[];
  regions: RegionRow[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<DatabaseHostRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DatabaseHostRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const regionName = (id: string) =>
    regions.find((region) => region.id === id)?.display ?? id;

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeletePending(true);
    try {
      const response = await deleteDatabaseHost({
        path: { host_id: deleting.id },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? "Failed to delete the database host",
        );
        return;
      }

      toast.success("Database host deleted");
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
          <h1 className="text-xl font-semibold">Database hosts</h1>
          <p className="text-sm text-muted-foreground">
            Each host runs a database agent. Projects get their databases on one
            of its instances, preferring a host in the project&apos;s region.
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            Register host
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Public host</TableHead>
              <TableHead>Ports</TableHead>
              <TableHead>Instances</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hosts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Database className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      No database hosts registered
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Register one to let projects create databases.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              hosts.map((host) => (
                <TableRow key={host.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/databases/${host.id}`}
                      className="hover:underline"
                    >
                      {host.display}
                    </Link>
                  </TableCell>
                  <TableCell>{regionName(host.region)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {host.public_host}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {Object.entries(host.ports)
                      .map(([type, port]) => `${type}:${port}`)
                      .join(" ") || "defaults"}
                  </TableCell>
                  <TableCell>{host.instance_count}</TableCell>
                  <TableCell>
                    {host.maintenance ? (
                      <Badge variant="secondary">Maintenance</Badge>
                    ) : (
                      <Badge>Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(host)}
                          aria-label="Edit host"
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(host)}
                          aria-label="Delete host"
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

      <DatabaseHostDialog
        open={creating}
        onOpenChange={setCreating}
        regions={regions}
        onSaved={onChanged}
      />
      <DatabaseHostDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        host={editing ?? undefined}
        regions={regions}
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
              The host is only unregistered here; nothing is removed from the
              machine itself. It must have no instances left.
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
