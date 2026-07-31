"use client";

import { resyncTemplateAction } from "@/actions/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListTemplateUsageResponses, ResyncTemplateResponse } from "@/lib/api";
import { listTemplateUsage } from "@/lib/api";
import { useAction } from "@/lib/action-hooks";
import { Boxes, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

type TemplateUsage = ListTemplateUsageResponses[200][number];
type ResyncStatus = ResyncTemplateResponse["servers"][number]["status"];

/** What each per-server outcome means, in the operator's terms. */
const STATUS_LABELS: Record<ResyncStatus, string> = {
  updated: "Updated",
  migrated: "Updated (config migrated)",
  node_missing: "Node not registered",
  node_failure: "Node unreachable",
  template_missing: "Template no longer exists",
  template_unavailable: "Template cache not ready",
  template_corrupted: "Configuration unreadable",
  failure: "Internal failure",
};

export function TemplatesView() {
  // `null` targets every template; a string targets that one. `undefined` means
  // no confirmation is open.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [restart, setRestart] = useState(false);
  const [report, setReport] = useState<ResyncTemplateResponse | null>(null);

  const {
    data: templates,
    error,
    isLoading,
    mutate,
  } = useSWR("admin-templates", async () => {
    const response = await listTemplateUsage();
    if (response.error) {
      throw new Error(response.error.error?.msg ?? "Failed to load templates");
    }
    return response.data ?? [];
  });

  const resync = useAction(resyncTemplateAction, {
    onSuccess: ({ data }) => {
      setTarget(undefined);
      setReport(data ?? null);
      void mutate();
      if (data) {
        toast.success(
          `${data.updated} of ${data.total} server${data.total === 1 ? "" : "s"} updated`,
        );
      }
    },
    onError: (actionError) => {
      toast.error(actionError.error.serverError ?? "Something went wrong");
    },
  });

  const totalServers = (templates ?? []).reduce(
    (total: number, template: TemplateUsage) => total + template.servers,
    0,
  );
  const failures = (report?.servers ?? []).filter(
    (server) => server.status !== "updated" && server.status !== "migrated",
  );

  if (error) {
    return (
      <div className="text-sm text-destructive">Failed to load templates.</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold">Templates</h1>
          <p className="text-sm text-muted-foreground">
            A server keeps the build it was created with. After fixing a
            template, resync its servers to push the new build to their nodes.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setRestart(false);
            setTarget(null);
          }}
          disabled={totalServers === 0}
        >
          <RefreshCw className="size-4" />
          Resync all servers
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Servers</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={3}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : !templates || templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Boxes className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No templates</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              templates.map((template: TemplateUsage) => (
                <TableRow key={template.id}>
                  <TableCell className="font-mono text-sm">
                    {template.id}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {template.servers} server
                      {template.servers === 1 ? "" : "s"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={template.servers === 0}
                      onClick={() => {
                        setRestart(false);
                        setTarget(template.id);
                      }}
                    >
                      <RefreshCw className="size-4" />
                      Resync
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={target !== undefined}
        onOpenChange={(open) => {
          if (!open && !resync.isExecuting) setTarget(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target === null
                ? "Resync every server?"
                : `Resync servers using ${target}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every affected server gets a freshly generated build pushed to its
              node. Without a restart it takes effect the next time the server
              starts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-sm font-normal">
            <Checkbox
              checked={restart}
              disabled={resync.isExecuting}
              onCheckedChange={(next) => setRestart(next === true)}
            />
            <span>
              Restart running servers
              <span className="block text-xs text-muted-foreground">
                Applies the new build immediately and disconnects players.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resync.isExecuting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                resync.execute({ template: target ?? undefined, restart });
              }}
              disabled={resync.isExecuting}
            >
              {resync.isExecuting ? "Resyncing..." : "Resync"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={report !== null}
        onOpenChange={(open) => {
          if (!open) setReport(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resync finished</DialogTitle>
            <DialogDescription>
              {report?.updated ?? 0} of {report?.total ?? 0} server
              {report?.total === 1 ? "" : "s"} updated
              {report?.migrated ? `, ${report.migrated} migrated` : ""}
              {report?.restarted ? `, ${report.restarted} restarted` : ""}.
            </DialogDescription>
          </DialogHeader>

          {failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every server accepted the new build.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {failures.length} server{failures.length === 1 ? "" : "s"} could
                not be resynced
              </p>
              <ScrollArea className="h-56 rounded-md border">
                <div className="divide-y">
                  {failures.map((server) => (
                    <div
                      key={server.server}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {server.name}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {server.server} · {server.template}
                        </div>
                      </div>
                      <Badge variant="destructive">
                        {STATUS_LABELS[server.status]}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            <Button type="button" onClick={() => setReport(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
