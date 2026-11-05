"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
import type { RouteRecord } from "@/lib/api";

/** SRV records carry priority, weight and port in front of the target. */
export function recordValue(record: RouteRecord) {
  if (record.record_type === "SRV") {
    return `${record.priority ?? 0} 0 ${record.port ?? 0} ${record.value}`;
  }
  return record.value;
}

export function DnsRecordsTable({ records }: { records: RouteRecord[] }) {
  const { t } = useTranslation();

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("common:actions.copied"));
    } catch {
      toast.error(t("servers:routes.toasts.copyFailed"));
    }
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("servers:routes.table.type")}</TableHead>
            <TableHead>{t("common:labels.name")}</TableHead>
            <TableHead>{t("common:labels.value")}</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const value = recordValue(record);
            return (
              <TableRow key={`${record.record_type}-${record.name}-${value}`}>
                <TableCell>
                  <Badge variant="outline">{record.record_type}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {record.name}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label={t("common:actions.copy")}
                      onClick={() => void copy(record.name)}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs break-all">
                  {value}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("common:actions.copy")}
                    onClick={() => void copy(value)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
