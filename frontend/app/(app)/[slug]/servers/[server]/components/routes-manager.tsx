"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createRoute,
  deleteRoute,
  listRouteDomains,
  listRoutes,
  serverInfo,
  type ListRouteDomainsResponse,
  type ListRoutesResponse,
  type NetworkPort,
} from "@/lib/api";

type RoutesManagerProps = {
  serverId: string;
  canManage: boolean;
};

type Route = ListRoutesResponse[number];
type Domain = ListRouteDomainsResponse[number];

const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function errorMessage(
  error: { error?: { msg?: string } } | undefined,
  fallback: string,
) {
  return error?.error?.msg ?? fallback;
}

export function RoutesManager({ serverId, canManage }: RoutesManagerProps) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [ports, setPorts] = useState<NetworkPort[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Route | null>(null);

  const [subdomain, setSubdomain] = useState("");
  const [domainId, setDomainId] = useState<string>("");
  const [portId, setPortId] = useState<string>("");
  const [service, setService] = useState("");
  const [https, setHttps] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const [routesResponse, serverResponse] = await Promise.all([
        listRoutes({ path: { server_id: serverId } }),
        serverInfo({ path: { server_id: serverId } }),
      ]);

      if (routesResponse.error || !routesResponse.data) {
        throw new Error(
          errorMessage(routesResponse.error, "Failed to load routes"),
        );
      }

      setRoutes(routesResponse.data);
      setPorts(
        (serverResponse.data?.network?.ports ?? []).filter(
          (port) => String(port.protocol) === "tcp",
        ),
      );

      const project = serverResponse.data?.project;
      const domainsResponse = await listRouteDomains(
        project ? { query: { project } } : {},
      );
      setDomains(domainsResponse.data ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load routes",
      );
    } finally {
      setIsLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedDomain = useMemo(
    () => domains.find((domain) => String(domain.id) === domainId),
    [domains, domainId],
  );

  const routablePorts = useMemo(
    () =>
      ports.filter((port) =>
        port.http
          ? domains.some((domain) => domain.http_available)
          : domains.some((domain) => domain.tcp_available),
      ),
    [ports, domains],
  );

  const selectablePorts = useMemo(
    () =>
      routablePorts.filter((port) =>
        selectedDomain
          ? port.http
            ? selectedDomain.http_available
            : selectedDomain.tcp_available
          : true,
      ),
    [routablePorts, selectedDomain],
  );

  const selectedPort = useMemo(
    () => selectablePorts.find((port) => String(port.id) === portId),
    [selectablePorts, portId],
  );

  const httpConfigured = domains.some((domain) => domain.http_available);
  const tcpConfigured = domains.some((domain) => domain.tcp_available);

  const isHttpRoute = selectedPort?.http === true;
  const httpsAvailable = isHttpRoute && (selectedDomain?.https ?? true);

  const subdomainValid =
    subdomain.length > 0 && SUBDOMAIN_PATTERN.test(subdomain);
  const serviceValid = service.length === 0 || SUBDOMAIN_PATTERN.test(service);

  const openCreate = () => {
    setSubdomain("");
    setDomainId(domains[0] ? String(domains[0].id) : "");
    setPortId(routablePorts[0] ? String(routablePorts[0].id) : "");
    setService("");
    setHttps(domains[0]?.https ?? true);
    setCreateOpen(true);
  };

  const submit = async () => {
    if (!subdomainValid || !serviceValid || !domainId || !portId) return;

    setIsSubmitting(true);

    try {
      const response = await createRoute({
        path: { server_id: serverId },
        body: {
          domain: Number(domainId),
          subdomain,
          port: Number(portId),
          service: isHttpRoute || service.length === 0 ? null : service,
          https: https && httpsAvailable,
        },
      });

      if (response.error || !response.data) {
        throw new Error(errorMessage(response.error, "Failed to create route"));
      }

      toast.success(`Route ${response.data.fqdn} created`);
      setCreateOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create route",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;

    setIsSubmitting(true);

    try {
      const response = await deleteRoute({
        path: { server_id: serverId, route_id: pendingDelete.id },
      });

      if (response.error) {
        throw new Error(errorMessage(response.error, "Failed to delete route"));
      }

      toast.success("Route deleted");
      setPendingDelete(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete route",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Routes</CardTitle>
              <CardDescription>
                Point a subdomain at one of this server&apos;s TCP ports.
              </CardDescription>
            </div>
            {canManage ? (
              <Button
                type="button"
                onClick={openCreate}
                disabled={
                  isLoading ||
                  domains.length === 0 ||
                  routablePorts.length === 0
                }
              >
                <Plus className="size-4" />
                New route
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : routes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {domains.length === 0
                ? "No domains are available for this project yet."
                : routablePorts.length === 0
                  ? "None of this server's ports can be routed yet."
                  : "No routes yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>HTTPS</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-0" />
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
                            ? "HTTP"
                            : `SRV${route.service ? ` _${route.service}` : ""}`}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {route.external_port}
                      </TableCell>
                      <TableCell>
                        {route.kind === "http" ? (
                          <Badge
                            variant={route.https ? "default" : "secondary"}
                          >
                            {route.https ? "on" : "off"}
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
                      <TableCell>
                        {canManage ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setPendingDelete(route)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {routes.some((route) => route.records.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>DNS records</CardTitle>
            <CardDescription>
              What was created for your routes — Cloudflare records for TCP
              routes, the Pangolin resource and its target for HTTP routes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {routes
              .filter((route) => route.records.length > 0)
              .map((route) => (
                <div key={route.id} className="space-y-2">
                  <p className="text-sm font-medium">{route.fqdn}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>TTL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {route.records.map((record, index) => (
                          <TableRow key={`${route.id}-${index}`}>
                            <TableCell>
                              <Badge variant="outline">
                                {record.record_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {record.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {record.value}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {record.ttl === 1 ? "auto" : (record.ttl ?? "—")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Setting up a route</CardTitle>
          <CardDescription>
            What a route can point at, and what to do when it can&apos;t.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {tcpConfigured ? (
            <div className="space-y-1">
              <p className="font-medium">TCP ports — game traffic</p>
              <p className="text-muted-foreground">
                A raw TCP port such as Minecraft&apos;s 25565 gets an SRV
                record, so players just enter{" "}
                <code className="font-mono">your-name.the-domain</code> and
                their client finds the port on its own. The service name decides
                which clients look it up (
                <code className="font-mono">minecraft</code> becomes{" "}
                <code className="font-mono">_minecraft._tcp</code>) and defaults
                to the port&apos;s name.
              </p>
            </div>
          ) : null}
          {httpConfigured ? (
            <div className="space-y-1">
              <p className="font-medium">HTTP ports — web traffic</p>
              <p className="text-muted-foreground">
                A port marked as an HTTP port — a web map like BlueMap, a panel,
                an API — is published as a reverse-proxied resource instead,
                reachable at the subdomain with HTTPS and no port in the URL. If
                the port you want is still listed as raw TCP, ask an admin to
                switch its protocol to HTTP under the server&apos;s ports.
              </p>
            </div>
          ) : null}
          {!httpConfigured && !tcpConfigured ? (
            <p className="text-muted-foreground">
              No domain offered to this project can carry routes yet. An admin
              has to link a domain to Pangolin for HTTP routes, or configure
              Cloudflare for TCP routes.
            </p>
          ) : null}
          <div className="space-y-1">
            <p className="font-medium">Either way</p>
            <p className="text-muted-foreground">
              Your software keeps listening on the port&apos;s internal port and
              nothing inside the server changes. Private domains only show up
              when an admin granted them to your project.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New route</DialogTitle>
            <DialogDescription>
              Pick a subdomain, the domain it lives under and the TCP port it
              points at.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="route-subdomain">Address</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="route-subdomain"
                  value={subdomain}
                  placeholder="my-server"
                  autoComplete="off"
                  onChange={(event) =>
                    setSubdomain(event.target.value.toLowerCase())
                  }
                />
                <Select
                  value={domainId}
                  onValueChange={(value) => {
                    setDomainId(value);
                    const domain = domains.find(
                      (entry) => String(entry.id) === value,
                    );
                    if (!domain) return;
                    if (!domain.https) setHttps(false);

                    const stillRoutable = routablePorts.filter((port) =>
                      port.http ? domain.http_available : domain.tcp_available,
                    );
                    if (
                      !stillRoutable.some((port) => String(port.id) === portId)
                    ) {
                      setPortId(
                        stillRoutable[0] ? String(stillRoutable[0].id) : "",
                      );
                    }
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Domain" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((domain) => (
                      <SelectItem key={domain.id} value={String(domain.id)}>
                        .{domain.domain}
                        {domain.private ? " (private)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {subdomain.length > 0 && !subdomainValid ? (
                <p className="text-xs text-destructive">
                  Only lowercase letters, digits and dashes are allowed.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="route-port">Port</Label>
              <Select value={portId} onValueChange={setPortId}>
                <SelectTrigger id="route-port" className="w-full">
                  <SelectValue placeholder="Port" />
                </SelectTrigger>
                <SelectContent>
                  {selectablePorts.map((port) => (
                    <SelectItem key={port.id} value={String(port.id)}>
                      {port.name} — {port.host}:{port.external_port_start} (
                      {port.http ? "HTTP" : "TCP"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {isHttpRoute
                  ? "An HTTP port becomes a reverse-proxied resource on the subdomain."
                  : "A raw TCP port gets an SRV record on the subdomain."}
              </p>
              {selectablePorts.length === 0 ? (
                <p className="text-xs text-destructive">
                  This domain cannot carry any of this server&apos;s ports yet.
                </p>
              ) : null}
            </div>

            {isHttpRoute ? (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="route-https">HTTPS</Label>
                  <p className="text-xs text-muted-foreground">
                    {(selectedDomain?.https ?? true)
                      ? "Serve this route over HTTPS."
                      : "This domain does not offer HTTPS."}
                  </p>
                </div>
                <Switch
                  id="route-https"
                  checked={https && httpsAvailable}
                  disabled={!(selectedDomain?.https ?? true)}
                  onCheckedChange={setHttps}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="route-service">SRV service</Label>
                <Input
                  id="route-service"
                  value={service}
                  placeholder={selectedPort?.name ?? "minecraft"}
                  autoComplete="off"
                  onChange={(event) =>
                    setService(event.target.value.toLowerCase())
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Creates{" "}
                  <code className="font-mono">
                    _{service || selectedPort?.name || "minecraft"}._tcp.
                    {subdomain || "your-name"}.
                    {selectedDomain?.domain ?? "the-domain"}
                  </code>
                  . Leave empty to use the port&apos;s name.
                </p>
                {!serviceValid ? (
                  <p className="text-xs text-destructive">
                    Only lowercase letters, digits and dashes are allowed.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={
                isSubmitting ||
                !subdomainValid ||
                !serviceValid ||
                !domainId ||
                !portId
              }
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Create route
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete route</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.fqdn} stops resolving and its records are removed
              from the provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
