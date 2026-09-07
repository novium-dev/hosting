"use client";

import { ExternalLink, Globe, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListDomainRoutesResponses } from "@/lib/api";

export type DomainRouteRow = ListDomainRoutesResponses[200][number];

export function DomainRoutesTable({
  domainName,
  routes,
  isLoading,
}: {
  domainName: string;
  routes: DomainRouteRow[];
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/admin/domains" className="hover:underline">
            {t("admin-core:domains.routes.breadcrumb")}
          </Link>
        </p>
        <h1 className="text-xl font-semibold">{domainName}</h1>
        <p className="text-sm text-muted-foreground">
          {t("admin-core:domains.routes.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : routes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("admin-core:domains.routes.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-muted">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>{t("common:labels.address")}</TableHead>
                <TableHead>{t("servers:routes.table.kind")}</TableHead>
                <TableHead>{t("admin-core:domains.routes.server")}</TableHead>
                <TableHead>{t("common:labels.project")}</TableHead>
                <TableHead>{t("common:labels.port")}</TableHead>
                <TableHead>{t("common:resources.https")}</TableHead>
                <TableHead>{t("common:labels.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell>
                    {route.kind === "http" ? (
                      <a
                        className="inline-flex items-center gap-1.5 font-medium hover:underline"
                        href={route.address}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Globe className="size-4 text-muted-foreground" />
                        {route.fqdn}
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Globe className="size-4 text-muted-foreground" />
                        {route.fqdn}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {route.kind === "http"
                        ? t("common:resources.http")
                        : `${t("servers:routes.srvBadge")}${
                            route.service
                              ? ` _${route.service}._${route.kind}`
                              : ` ${route.kind.toUpperCase()}`
                          }`}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${route.project_slug}/servers/${route.server}`}
                      className="font-medium hover:underline"
                    >
                      {route.server_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${route.project_slug}`}
                      className="hover:underline"
                    >
                      {route.project_name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {route.external_port}
                  </TableCell>
                  <TableCell>
                    {route.kind === "http" ? (
                      <Badge variant={route.https ? "default" : "secondary"}>
                        {route.https
                          ? t("common:status.enabled")
                          : t("common:status.disabled")}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        route.status === "active" ? "default" : "secondary"
                      }
                    >
                      {route.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
