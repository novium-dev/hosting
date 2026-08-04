"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

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
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await serverInfo({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error("Failed to load network ports");
      }

      setPorts(toPortRows(response.data));
    } catch {
      toast.error("Failed to load network ports");
    } finally {
      setIsLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPorts = useMemo(() => ports.length > 0, [ports]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>Network</CardTitle>
            <CardDescription>
              Every port exposed for this server. Raw ports are reached by host
              and port, HTTP ports through a route.
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
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading network ports...
            </div>
          ) : !hasPorts ? (
            <p className="text-sm text-muted-foreground">
              No network ports are configured for this server.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Internal</TableHead>
                    <TableHead>External</TableHead>
                    <TableHead>Host / Bind</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ports.map((port) => (
                    <TableRow key={port.id}>
                      <TableCell className="font-medium">{port.name}</TableCell>
                      <TableCell>
                        {port.http ? "HTTP" : port.protocol}
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
                          <Badge variant="default">Primary</Badge>
                        ) : (
                          <Badge variant="secondary">Additional</Badge>
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
