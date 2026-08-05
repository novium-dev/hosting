"use client";

import Link from "@/components/link";
import { useMemo, useState } from "react";
import { Plus, Search, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListServersResponses } from "@/lib/api";

type ServerRow = ListServersResponses[200][number];

export function ServersTable({ servers }: { servers: ServerRow[] }) {
  const { t } = useTranslation(["admin-infra", "common"]);
  const [query, setQuery] = useState("");

  const filteredServers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return servers;
    }

    return servers.filter((server) => {
      return (
        server.name.toLowerCase().includes(normalizedQuery) ||
        server.id.toLowerCase().includes(normalizedQuery) ||
        server.node.toLowerCase().includes(normalizedQuery) ||
        server.project.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [query, servers]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {t("common:nav.servers")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:servers.table.description")}
          </p>
        </div>
        <Button asChild>
          <Link
            href="/admin/servers/create"
            className="inline-flex items-center"
          >
            <Plus className="size-4" />
            {t("admin-infra:servers.shared.createServerLabel")}
          </Link>
        </Button>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin-infra:servers.table.searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("common:labels.name")}</TableHead>
              <TableHead>{t("common:labels.id")}</TableHead>
              <TableHead>{t("admin-infra:servers.table.columns.node")}</TableHead>
              <TableHead>
                {t("admin-infra:servers.table.columns.projectId")}
              </TableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredServers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32">
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
              filteredServers.map((server) => (
                <TableRow key={server.id}>
                  <TableCell className="font-medium">{server.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {server.id}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {server.node}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {server.project}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/servers/${server.id}`}>
                        {t("common:resources.manage")}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
