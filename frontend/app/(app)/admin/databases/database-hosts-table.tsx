"use client";

import { useMemo, useState } from "react";
import {
  Clock,
  Database,
  PencilIcon,
  PlusIcon,
  TimerResetIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { SortableTableHead } from "@/components/sortable-table-head";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTableSort } from "@/hooks/use-table-sort";
import {
  deleteDatabaseHost,
  extendDatabaseHostRegistration,
  listDatabaseHostRegistrations,
  type ListDatabaseHostRegistrationsResponses,
  type ListDatabaseHostsResponses,
} from "@/lib/api";
import { GroupBadges } from "@/components/group-badges";
import { DatabaseHostDialog } from "./database-host-dialog";
import type { GroupRef } from "@/lib/api";
import { formatCountdown } from "@/lib/format";

export type DatabaseHostRow = ListDatabaseHostsResponses[200][number];
export type DatabaseHostRegistrationRow =
  ListDatabaseHostRegistrationsResponses[200][number];

type HostColumn = "display" | "groups" | "publicHost" | "instances" | "status";

export function DatabaseHostsTable({
  hosts,
  groups,
  canManage,
  onChanged,
}: {
  hosts: DatabaseHostRow[];
  groups: GroupRef[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<DatabaseHostRow | null>(null);
  const [editingRegistration, setEditingRegistration] =
    useState<DatabaseHostRegistrationRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DatabaseHostRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [extending, setExtending] = useState<string | null>(null);

  const { data: registrations, mutate: mutateRegistrations } = useSWR(
    "admin/database-host/registrations",
    async () => {
      const response = await listDatabaseHostRegistrations();
      return response.error ? [] : (response.data ?? []);
    },
    { refreshInterval: 30_000 },
  );

  const accessors = useMemo(
    () => ({
      display: (host: DatabaseHostRow) => host.display,
      groups: (host: DatabaseHostRow) => host.groups.length,
      publicHost: (host: DatabaseHostRow) => host.public_host,
      instances: (host: DatabaseHostRow) => host.instance_count,
      status: (host: DatabaseHostRow) => host.maintenance,
    }),
    [],
  );

  const { rows, sort, toggle } = useTableSort<DatabaseHostRow, HostColumn>(
    hosts,
    accessors,
    { column: "display", direction: "asc" },
  );

  const handleExtend = async (code: string) => {
    setExtending(code);
    try {
      const response = await extendDatabaseHostRegistration({ path: { code } });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:databases.hostsTable.extendFailed"),
        );
        return;
      }

      toast.success(t("admin-infra:databases.hostsTable.extended"));
      await mutateRegistrations();
    } finally {
      setExtending(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeletePending(true);
    try {
      const response = await deleteDatabaseHost({
        path: { host_id: deleting.id },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:databases.hostsTable.deleteError"),
        );
        return;
      }

      toast.success(t("admin-infra:databases.hostsTable.deleteSuccess"));
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
            {t("admin-infra:databases.hostsTable.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:databases.hostsTable.description")}
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            {t("admin-infra:databases.hostDialog.registerButton")}
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <SortableTableHead column="display" sort={sort} onSort={toggle}>
                {t("common:labels.name")}
              </SortableTableHead>
              <SortableTableHead column="groups" sort={sort} onSort={toggle}>
                {t("navigation:adminSidebar.items.groups")}
              </SortableTableHead>
              <SortableTableHead
                column="publicHost"
                sort={sort}
                onSort={toggle}
              >
                {t("admin-infra:databases.hostsTable.columns.publicHost")}
              </SortableTableHead>
              <TableHead>{t("common:nav.ports")}</TableHead>
              <SortableTableHead column="instances" sort={sort} onSort={toggle}>
                {t("admin-infra:databases.hostsTable.columns.instances")}
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
            {rows.length === 0 && (registrations ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Database className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("admin-infra:databases.hostsTable.emptyState.title")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "admin-infra:databases.hostsTable.emptyState.description",
                      )}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {(registrations ?? []).map((registration) => (
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
                            {t("admin-infra:databases.hostsTable.pendingTooltip", {
                              expires: formatCountdown(registration.expires_in),
                            })}
                          </TooltipContent>
                        </Tooltip>
                        <div>
                          {registration.display}
                          <div className="font-mono text-xs font-normal text-muted-foreground">
                            {registration.code}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <GroupBadges groups={registration.groups} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {registration.public_host}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Object.entries(registration.ports)
                        .map(([type, port]) => `${type}:${port}`)
                        .join(" ") ||
                        t("admin-infra:databases.hostsTable.portsDefaultLabel")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t("admin-infra:databases.hostsTable.pendingSetup")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingRegistration(registration)}
                            aria-label={t(
                              "admin-infra:databases.hostsTable.editAria",
                            )}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                loading={extending === registration.code}
                                onClick={() =>
                                  void handleExtend(registration.code)
                                }
                              >
                                <TimerResetIcon className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("admin-infra:databases.hostsTable.extendTooltip")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.map((host) => (
                <TableRow key={host.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/databases/${host.id}`}
                      className="hover:underline"
                    >
                      {host.display}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <GroupBadges groups={host.groups} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {host.public_host}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {Object.entries(host.ports)
                      .map(([type, port]) => `${type}:${port}`)
                      .join(" ") ||
                      t("admin-infra:databases.hostsTable.portsDefaultLabel")}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {host.instance_count}
                  </TableCell>
                  <TableCell>
                    {host.maintenance ? (
                      <Badge variant="secondary">
                        {t("admin-infra:shared.maintenance")}
                      </Badge>
                    ) : (
                      <Badge>{t("common:status.active")}</Badge>
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
                          aria-label={t(
                            "admin-infra:databases.hostsTable.editAria",
                          )}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(host)}
                          aria-label={t(
                            "admin-infra:databases.hostsTable.deleteAria",
                          )}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                  </TableRow>
                ))}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      <DatabaseHostDialog
        open={creating}
        onOpenChange={setCreating}
        groups={groups}
        onSaved={() => {
          void mutateRegistrations();
          onChanged();
        }}
      />
      <DatabaseHostDialog
        open={editingRegistration !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRegistration(null);
        }}
        registration={editingRegistration ?? undefined}
        groups={groups}
        onSaved={() => void mutateRegistrations()}
      />
      <DatabaseHostDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        host={editing ?? undefined}
        groups={groups}
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
            <AlertDialogTitle>
              {t("common:confirmDelete.title", { name: deleting?.display })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:databases.hostsTable.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isDeletePending}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
