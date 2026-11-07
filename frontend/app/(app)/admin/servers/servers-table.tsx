"use client";

import useSWR from "swr";
import { Plus, Search, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { SortableTableHead } from "@/components/sortable-table-head";
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
import { TablePagination } from "@/components/table-pagination";
import { toPage, usePagedTable } from "@/hooks/use-paged-table";
import { listServers, type ServerSort } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";

export function ServersTable() {
  const { t } = useTranslation(["admin-infra", "common"]);
  const { data: session } = authClient.useSession();
  const { page, setPage, search, setSearch, sort, toggle, query } =
    usePagedTable<ServerSort>({ column: "name", direction: "asc" });

  const { data } = useSWR(
    ["admin/servers/page", query],
    async ([, query]) => toPage(await listServers({ query })),
    { keepPreviousData: true },
  );
  const rows = data?.items ?? [];

  const canViewNodes = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_VIEW,
      )
    : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.servers")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:servers.table.description")}
          </p>
        </div>
        <Button
          render={
            <Link
              href="/admin/servers/create"
              className="inline-flex items-center"
            />
          }
          nativeButton={false}
        >
          <Plus className="size-4" />
          {t("admin-infra:servers.shared.createServerLabel")}
        </Button>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("admin-infra:servers.table.searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <SortableTableHead column="name" sort={sort} onSort={toggle}>
                {t("common:labels.name")}
              </SortableTableHead>
              <SortableTableHead column="template" sort={sort} onSort={toggle}>
                {t("common:labels.template")}
              </SortableTableHead>
              <SortableTableHead column="node" sort={sort} onSort={toggle}>
                {t("admin-infra:servers.table.columns.node")}
              </SortableTableHead>
              <SortableTableHead column="group" sort={sort} onSort={toggle}>
                {t("admin-infra:servers.shared.groupLabel")}
              </SortableTableHead>
              <SortableTableHead column="project" sort={sort} onSort={toggle}>
                {t("common:labels.project")}
              </SortableTableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Server className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("admin-infra:servers.table.emptyState.title")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("admin-infra:servers.table.emptyState.description")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((server) => (
                <TableRow key={server.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/servers/${server.id}`}
                        className="font-medium hover:underline"
                      >
                        {server.name}
                      </Link>
                      {server.suspended && (
                        <Badge variant="destructive">
                          {t("common:status.suspended")}
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {server.id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {server.template}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canViewNodes ? (
                      <Link
                        href={`/admin/nodes/${server.node_id}`}
                        className="hover:underline"
                      >
                        {server.node}
                      </Link>
                    ) : (
                      server.node
                    )}
                  </TableCell>
                  <TableCell>
                    {server.group ? (
                      <Badge variant="outline" className="font-normal">
                        {server.group.label}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("admin-infra:servers.shared.noGroup")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${server.project_slug}`}
                      className="hover:underline"
                    >
                      {server.project_name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">
                      {server.project_slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/servers/${server.id}`} />}
                      nativeButton={false}
                    >
                      {t("common:resources.manage")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={page}
        total={data?.total ?? 0}
        totalPages={data?.totalPages ?? 1}
        onPageChange={setPage}
      />
    </div>
  );
}
