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
import { useTranslation } from "react-i18next";

type TemplateUsage = ListTemplateUsageResponses[200][number];
type ResyncStatus = ResyncTemplateResponse["servers"][number]["status"];

const STATUS_LABEL_KEYS: Record<ResyncStatus, string> = {
  updated: "updated",
  migrated: "migrated",
  node_missing: "nodeMissing",
  node_failure: "nodeFailure",
  template_missing: "templateMissing",
  template_unavailable: "templateUnavailable",
  template_corrupted: "templateCorrupted",
  failure: "failure",
};

export function TemplatesView() {
  const { t } = useTranslation(["admin-infra", "common"]);
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
      throw new Error(
        response.error.error?.msg ?? t("admin-infra:templates.view.loadError"),
      );
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
          t("admin-infra:templates.view.resyncToast", {
            count: data.total,
            updated: data.updated,
          }),
        );
      }
    },
    onError: (actionError) => {
      toast.error(actionError.error.serverError ?? t("common:state.genericError"));
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
      <div className="text-sm text-destructive">
        {t("admin-infra:templates.view.loadErrorDisplay")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold">
            {t("common:nav.templates")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:templates.view.description")}
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
          {t("admin-infra:templates.view.resyncAllButton")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("admin-infra:servers.shared.templateLabel")}</TableHead>
              <TableHead>{t("common:nav.servers")}</TableHead>
              <TableHead className="text-right">
                {t("common:labels.actions")}
              </TableHead>
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
                    <p className="text-sm font-medium">
                      {t("admin-infra:templates.view.emptyState")}
                    </p>
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
                      {t("admin-infra:templates.view.serverCount", {
                        count: template.servers,
                      })}
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
                      {t("admin-infra:templates.view.resyncButton")}
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
                ? t("admin-infra:templates.view.resyncAllTitle")
                : t("admin-infra:templates.view.resyncTemplateTitle", {
                    template: target,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:templates.view.resyncDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-sm font-normal">
            <Checkbox
              checked={restart}
              disabled={resync.isExecuting}
              onCheckedChange={(next) => setRestart(next === true)}
            />
            <span>
              {t("admin-infra:templates.view.restartLabel")}
              <span className="block text-xs text-muted-foreground">
                {t("admin-infra:templates.view.restartHint")}
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resync.isExecuting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                resync.execute({ template: target ?? undefined, restart });
              }}
              disabled={resync.isExecuting}
            >
              {resync.isExecuting
                ? t("admin-infra:templates.view.resyncingLabel")
                : t("admin-infra:templates.view.resyncButton")}
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
            <DialogTitle>{t("admin-infra:templates.view.resyncFinishedTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin-infra:templates.view.resyncToast", {
                count: report?.total ?? 0,
                updated: report?.updated ?? 0,
              })}
              {report?.migrated
                ? t("admin-infra:templates.view.migratedSuffix", {
                    count: report.migrated,
                  })
                : ""}
              {report?.restarted
                ? t("admin-infra:templates.view.restartedSuffix", {
                    count: report.restarted,
                  })
                : ""}
              .
            </DialogDescription>
          </DialogHeader>

          {failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:templates.view.allAccepted")}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("admin-infra:templates.view.failuresCount", {
                  count: failures.length,
                })}
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
                        {t(
                          `admin-infra:templates.view.statusLabels.${STATUS_LABEL_KEYS[server.status]}`,
                        )}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            <Button type="button" onClick={() => setReport(null)}>
              {t("common:actions.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
