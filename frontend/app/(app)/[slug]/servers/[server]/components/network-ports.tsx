"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { serverInfo, type NetworkPort } from "@/lib/api";

type NetworkPortsProps = {
  serverId: string;
};

type PortRow = {
  id: number;
  name: string;
  protocol: string;
  internalPort: number;
  externalStart: number;
  externalEnd: number;
  host: string;
  bind: string | null;
  http: boolean;
  isPrimary: boolean;
};

function toPortRows(
  data: Awaited<ReturnType<typeof serverInfo>>["data"],
): PortRow[] {
  if (!data?.network?.ports) {
    return [];
  }

  const primaryId = data.primary_port?.port.id ?? null;
  const primaryExternal = data.primary_port?.external_port ?? null;

  return data.network.ports
    .map((port) => {
      const isPrimary = primaryId !== null && port.id === primaryId;

      return {
        id: port.id,
        name: port.name,
        protocol: String(port.protocol).toUpperCase(),
        internalPort: port.internal_port,
        externalStart:
          isPrimary && primaryExternal !== null
            ? primaryExternal
            : port.external_port_start,
        externalEnd:
          isPrimary && primaryExternal !== null
            ? primaryExternal
            : port.external_port_end,
        host: port.host,
        bind: port.bind ?? null,
        http: port.http,
        isPrimary,
      };
    })
    .sort((a, b) => a.id - b.id);
}

export function NetworkPorts({ serverId }: NetworkPortsProps) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await serverInfo({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error(t("servers:networkPorts.toasts.loadFailed"));
      }

      setPorts(toPortRows(response.data));
    } catch {
      toast.error(t("servers:networkPorts.toasts.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [serverId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPorts = useMemo(() => ports.length > 0, [ports]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>{t("servers:networkPorts.title")}</CardTitle>
            <CardDescription>
              {t("servers:networkPorts.description")}
            </CardDescription>
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refresh();
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              {t("common:actions.refresh")}
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("servers:networkPorts.loading")}
            </div>
          ) : !hasPorts ? (
            <p className="text-sm text-muted-foreground">
              {t("servers:networkPorts.empty")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.name")}</TableHead>
                    <TableHead>{t("servers:networkPorts.table.protocol")}</TableHead>
                    <TableHead>{t("servers:networkPorts.table.internal")}</TableHead>
                    <TableHead>{t("servers:networkPorts.table.external")}</TableHead>
                    <TableHead>{t("servers:networkPorts.table.hostBind")}</TableHead>
                    <TableHead>{t("common:labels.role")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ports.map((port) => (
                    <TableRow key={port.id}>
                      <TableCell className="font-medium">{port.name}</TableCell>
                      <TableCell>
                        {port.http
                          ? t("servers:networkPorts.httpLabel")
                          : port.protocol}
                      </TableCell>
                      <TableCell>{port.internalPort}</TableCell>
                      <TableCell>
                        {port.externalStart === port.externalEnd
                          ? port.externalStart
                          : `${port.externalStart}-${port.externalEnd}`}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {port.host}
                        {port.bind ? ` (${port.bind})` : ""}
                      </TableCell>
                      <TableCell>
                        {port.isPrimary ? (
                          <Badge variant="default">
                            {t("servers:networkPorts.primaryBadge")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            {t("servers:networkPorts.additionalBadge")}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
