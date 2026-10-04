"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { Clock, Network, Search, TimerResetIcon, Trash2Icon } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { SortableTableHead } from "@/components/sortable-table-head";
import { GroupBadges } from "@/components/group-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTableSort } from "@/hooks/use-table-sort";
import {
  deleteNode,
  extendNodeRegistration,
  listNodeRegistrations,
  type ListNodesResponses,
} from "@/lib/api";
import {
  CreateNodeDialog,
  EditNodeRegistrationDialog,
  type NodeRegistration,
} from "./create-nodes";

type NodeRow = ListNodesResponses[200][number];

type NodeColumn = "display" | "groups" | "host" | "ports" | "servers" | "status";

function formatExpiry(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function NodesTable({
  nodes,
  canManage,
  onChanged,
}: {
  nodes: NodeRow[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [extending, setExtending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NodeRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const { data: registrations, mutate: mutateRegistrations } = useSWR(
    "admin/node/registrations",
    async () => {
      const response = await listNodeRegistrations();
      return response.error ? [] : (response.data ?? []);
    },
    { refreshInterval: 30_000 },
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    if (!normalizedQuery) {
      return nodes;
    }

    return nodes.filter((node) => {
      return (
        node.display.toLowerCase().includes(normalizedQuery) ||
        node.id.toLowerCase().includes(normalizedQuery) ||
        node.default_host.toLowerCase().includes(normalizedQuery) ||
        node.groups.some((group) =>
          group.toLowerCase().includes(normalizedQuery),
        )
      );
    });
  }, [nodes, normalizedQuery]);

  const filteredRegistrations = useMemo(() => {
    const pending: NodeRegistration[] = registrations ?? [];

    if (!normalizedQuery) {
      return pending;
    }

    return pending.filter((registration) => {
      return (
        registration.name.toLowerCase().includes(normalizedQuery) ||
        registration.code.toLowerCase().includes(normalizedQuery) ||
        registration.default_host.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [registrations, normalizedQuery]);

  const accessors = useMemo(
    () => ({
      display: (node: NodeRow) => node.display,
      groups: (node: NodeRow) => node.groups.length,
      host: (node: NodeRow) => node.default_host,
      ports: (node: NodeRow) => node.ports.length,
      servers: (node: NodeRow) => node.server_count,
      status: (node: NodeRow) => node.maintenance,
    }),
    [],
  );

  const { rows: sortedNodes, sort, toggle } = useTableSort<NodeRow, NodeColumn>(
    filteredNodes,
    accessors,
    { column: "display", direction: "asc" },
  );

  const isEmpty =
    sortedNodes.length === 0 && filteredRegistrations.length === 0;

  const handleExtend = async (code: string) => {
    setExtending(code);
    try {
      const response = await extendNodeRegistration({ path: { code } });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.table.extendFailed"),
        );
        return;
      }

      toast.success(t("admin-infra:nodes.table.extended"));
      await mutateRegistrations();
    } finally {
      setExtending(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeletePending(true);
    try {
      const response = await deleteNode({ path: { node_id: deleting.id } });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.deleteDialog.failed"),
        );
        return;
      }

      toast.success(t("admin-infra:nodes.deleteDialog.deleted"));
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
          <h1 className="text-xl font-semibold">
            {t("common:nav.nodes")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:nodes.table.description")}
          </p>
        </div>
        <CreateNodeDialog
          canCreate={canManage}
          onCreated={() => void mutateRegistrations()}
        />
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin-infra:nodes.table.searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <SortableTableHead column="display" sort={sort} onSort={toggle}>
                {t("admin-infra:nodes.table.columns.display")}
              </SortableTableHead>
              <SortableTableHead column="groups" sort={sort} onSort={toggle}>
                {t("navigation:adminSidebar.items.groups")}
              </SortableTableHead>
              <SortableTableHead column="host" sort={sort} onSort={toggle}>
                {t("admin-infra:nodes.shared.defaultHost")}
              </SortableTableHead>
              <SortableTableHead column="ports" sort={sort} onSort={toggle}>
                {t("common:nav.ports")}
              </SortableTableHead>
              <SortableTableHead column="servers" sort={sort} onSort={toggle}>
                {t("common:nav.servers")}
              </SortableTableHead>
              <SortableTableHead column="status" sort={sort} onSort={toggle}>
                {t("common:labels.status")}
              </SortableTableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Network className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("admin-infra:nodes.table.emptyState.title")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("admin-infra:nodes.table.emptyState.description")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {filteredRegistrations.map((registration) => (
                  <TableRow key={registration.code} className="bg-muted/20">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center">
                              <Clock className="size-4 shrink-0 text-amber-500" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("admin-infra:nodes.table.pendingTooltip", {
                              expires: formatExpiry(registration.expires_in),
                            })}
                          </TooltipContent>
                        </Tooltip>
                        <div>
                          {registration.name}
                          <div className="font-mono text-xs font-normal text-muted-foreground">
                            {registration.code}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="font-mono text-xs">
                      {registration.default_host}
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t("admin-infra:nodes.table.pendingSetup")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <EditNodeRegistrationDialog
                          registration={registration}
                          canManage={canManage}
                          onSaved={() => void mutateRegistrations()}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="outline"
                              disabled={!canManage}
                              loading={extending === registration.code}
                              onClick={() => void handleExtend(registration.code)}
                            >
                              <TimerResetIcon className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("admin-infra:nodes.table.extendTooltip")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedNodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell>
                      <Link
                        href={`/admin/nodes/${node.id}`}
                        className="font-medium hover:underline"
                      >
                        {node.display}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">
                        {node.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <GroupBadges groups={node.groups} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {node.default_host}
                      <div className="text-muted-foreground">
                        {node.default_bind}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {node.ports.length}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {node.server_count}
                    </TableCell>
                    <TableCell>
                      {node.maintenance ? (
                        <Badge variant="secondary">
                          {t("admin-infra:shared.maintenance")}
                        </Badge>
                      ) : (
                        <Badge>{t("common:status.active")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/nodes/${node.id}`}>
                            {t("common:resources.manage")}
                          </Link>
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center">
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={!canManage || node.server_count > 0}
                                onClick={() => setDeleting(node)}
                              >
                                <Trash2Icon className="size-4" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {node.server_count > 0
                              ? t("admin-infra:nodes.deleteDialog.blocked", {
                                  count: node.server_count,
                                })
                              : t("common:actions.delete")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:nodes.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? t("admin-infra:nodes.deleteDialog.description", {
                    display: deleting.display,
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
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
