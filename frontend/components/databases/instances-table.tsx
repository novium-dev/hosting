"use client";

import Link from "@/components/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListProjectInstancesResponses } from "@/lib/api";
import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DATABASE_TYPE_LABELS } from "./database-type";

export type ProjectInstance = ListProjectInstancesResponses[200][number];

interface InstancesTableProps {
  slug: string;
  instances: ProjectInstance[] | undefined;
  isLoading?: boolean;
  error?: boolean;
}

function StateBadge({ instance }: { instance: ProjectInstance }) {
  const { t } = useTranslation();

  if (instance.suspended) {
    return <Badge variant="destructive">{t("common:status.suspended")}</Badge>;
  }

  switch (instance.state) {
    case "running":
      return <Badge>{t("common:status.running")}</Badge>;
    case "starting":
      return <Badge variant="secondary">{t("common:status.starting")}</Badge>;
    case "stopping":
      return <Badge variant="secondary">{t("common:status.stopping")}</Badge>;
    default:
      return <Badge variant="outline">{t("common:status.offline")}</Badge>;
  }
}

function formatMib(value: number | null | undefined) {
  if (!value) return "—";
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${value} MiB`;
}

export function InstancesTable({
  slug,
  instances,
  isLoading = false,
  error = false,
}: InstancesTableProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {t("project:databases.instancesTable.loadError")}
      </p>
    );
  }

  if (!instances?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <Database className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {t("project:databases.instancesTable.emptyTitle")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("project:databases.instancesTable.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-muted">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead>{t("common:labels.name")}</TableHead>
            <TableHead>{t("project:databases.engineLabel")}</TableHead>
            <TableHead>
              {t("project:databases.instancesTable.stateColumn")}
            </TableHead>
            <TableHead>{t("common:labels.address")}</TableHead>
            <TableHead>{t("common:resources.memory")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((instance) => (
            <TableRow key={instance.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/${slug}/databases/${instance.id}`}
                  className="hover:underline"
                >
                  {instance.display}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {DATABASE_TYPE_LABELS[instance.type]}
                </Badge>
              </TableCell>
              <TableCell>
                <StateBadge instance={instance} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {instance.host}:{instance.port}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatMib(instance.memory_limit)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
