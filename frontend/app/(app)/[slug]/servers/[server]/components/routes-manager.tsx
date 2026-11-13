"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { ExternalLink, Globe, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";

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
import { apiErrorMessage } from "@/lib/api-error";
import { DnsRecordsTable } from "@/components/routes/dns-records-table";

type RoutesManagerProps = {
  serverId: string;
  canManage: boolean;
  canBypassLimits?: boolean;
};

type Route = ListRoutesResponse[number];
type Domain = ListRouteDomainsResponse[number];

const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MIN_SUBDOMAIN_LENGTH = 3;

/** Mirrors the backend: the SRV service name is derived from the port's name. */
function serviceName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const NO_ROUTE_DATA: {
  routes: Route[];
  domains: Domain[];
  ports: NetworkPort[];
} = {
  routes: [],
  domains: [],
  ports: [],
};

export function RoutesManager({
  serverId,
  canManage,
  canBypassLimits = false,
}: RoutesManagerProps) {
  const { t } = useTranslation();
  const {
    data,
    isValidating: isLoading,
    mutate,
  } = useSWR(
    ["server-routes", serverId],
    async () => {
      const [routesResponse, serverResponse] = await Promise.all([
        listRoutes({ path: { server_id: serverId } }),
        serverInfo({ path: { server_id: serverId } }),
      ]);

      if (routesResponse.error || !routesResponse.data) {
        throw new Error(
          apiErrorMessage(
            routesResponse.error,
            t("servers:routes.toasts.loadFailed"),
          ),
        );
      }

      const project = serverResponse.data?.project;
      const domainsResponse = await listRouteDomains(
        project ? { query: { project } } : {},
      );

      return {
        routes: routesResponse.data,
        ports: serverResponse.data?.network?.ports ?? [],
        domains: domainsResponse.data ?? [],
      };
    },
    {
      onError: (error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : t("servers:routes.toasts.loadFailed"),
        ),
    },
  );
  const { routes, domains, ports } = data ?? NO_ROUTE_DATA;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Route | null>(null);

  const [subdomain, setSubdomain] = useState("");
  const [domainId, setDomainId] = useState<string>("");
  const [portId, setPortId] = useState<string>("");
  const [https, setHttps] = useState(true);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const selectedDomain = useMemo(
    () => domains.find((domain) => String(domain.id) === domainId),
    [domains, domainId],
  );

  const routablePorts = useMemo(
    () =>
      ports.filter(
        (port) =>
          (canBypassLimits ||
            !routes.some((route) => route.port === port.id)) &&
          (port.http
            ? domains.some((domain) => domain.http_available)
            : domains.some((domain) => domain.tcp_available)),
      ),
    [ports, domains, routes, canBypassLimits],
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

  const customRecords = useMemo(
    () =>
      routes.flatMap((route) =>
        domains.some((domain) => domain.id === route.domain && domain.custom)
          ? route.records
          : [],
      ),
    [routes, domains],
  );

  const isHttpRoute = selectedPort?.http === true;
  const srvService = selectedPort
    ? serviceName(selectedPort.name)
    : "minecraft";
  const srvProtocol = String(selectedPort?.protocol ?? "tcp").toLowerCase();
  const httpsAvailable = isHttpRoute && (selectedDomain?.https ?? true);

  const apexAllowed = selectedDomain?.custom === true;
  const isApex = subdomain.length === 0;
  const subdomainValid = isApex
    ? apexAllowed
    : SUBDOMAIN_PATTERN.test(subdomain);
  const subdomainTooShort =
    !isApex && !canBypassLimits && subdomain.length < MIN_SUBDOMAIN_LENGTH;

  const openCreate = () => {
    setSubdomain("");
    setDomainId(domains[0] ? String(domains[0].id) : "");
    setPortId(routablePorts[0] ? String(routablePorts[0].id) : "");
    setHttps(domains[0]?.https ?? true);
    setCreateOpen(true);
  };

  const submit = async () => {
    if (!subdomainValid || subdomainTooShort || !domainId || !portId) return;

    setIsSubmitting(true);

    try {
      const response = await createRoute({
        path: { server_id: serverId },
        body: {
          domain: Number(domainId),
          subdomain,
          port: Number(portId),
          https: https && httpsAvailable,
        },
      });

      if (response.error || !response.data) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:routes.toasts.createFailed"),
          ),
        );
      }

      toast.success(
        t("servers:routes.toasts.createSuccess", { fqdn: response.data.fqdn }),
      );
      setCreateOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("servers:routes.toasts.createFailed"),
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
        throw new Error(
          apiErrorMessage(
            response.error,
            t("servers:routes.toasts.deleteFailed"),
          ),
        );
      }

      toast.success(t("servers:routes.toasts.deleteSuccess"));
      setPendingDelete(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("servers:routes.toasts.deleteFailed"),
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
              <CardTitle>{t("servers:routes.title")}</CardTitle>
              <CardDescription>
                {t("servers:routes.description")}
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
                {t("servers:routes.newRouteButton")}
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
                ? t("servers:routes.empty.noDomains")
                : routablePorts.length === 0
                  ? t("servers:routes.empty.noRoutablePorts")
                  : t("servers:routes.empty.noRoutes")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.address")}</TableHead>
                    <TableHead>{t("servers:routes.table.kind")}</TableHead>
                    <TableHead>{t("common:labels.port")}</TableHead>
                    <TableHead>{t("common:resources.https")}</TableHead>
                    <TableHead>{t("common:labels.status")}</TableHead>
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
                            ? t("common:resources.http")
                            : `${t("servers:routes.srvBadge")}${
                                route.service
                                  ? ` _${route.service}._${route.kind}`
                                  : ` ${route.kind.toUpperCase()}`
                              }`}
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

      {customRecords.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("servers:routes.customDns.title")}</CardTitle>
            <CardDescription>
              {t("servers:routes.customDns.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DnsRecordsTable records={customRecords} />
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("servers:routes.dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("servers:routes.dialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="route-subdomain">
                {t("common:labels.address")}
              </Label>
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
                  items={[
                    ...domains.map((domain) => ({
                      value: String(domain.id),
                      label: (
                        <>
                          .{domain.domain}
                          {domain.private
                            ? ` (${t("servers:routes.privateLabel")})`
                            : ""}
                          {domain.custom
                            ? ` (${t("servers:routes.customLabel")})`
                            : ""}
                        </>
                      ),
                    })),
                  ]}
                  value={domainId}
                  onValueChange={(value) => {
                    if (value === null) return;
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
                    <SelectValue
                      placeholder={t("servers:routes.dialog.domainPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((domain) => (
                      <SelectItem key={domain.id} value={String(domain.id)}>
                        .{domain.domain}
                        {domain.private
                          ? ` (${t("servers:routes.privateLabel")})`
                          : ""}
                        {domain.custom
                          ? ` (${t("servers:routes.customLabel")})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {subdomain.length > 0 && !subdomainValid ? (
                <p className="text-xs text-destructive">
                  {t("servers:routes.subdomainInvalid")}
                </p>
              ) : subdomain.length > 0 && subdomainTooShort ? (
                <p className="text-xs text-destructive">
                  {t("servers:routes.subdomainTooShort", {
                    min: MIN_SUBDOMAIN_LENGTH,
                  })}
                </p>
              ) : apexAllowed ? (
                <p className="text-xs text-muted-foreground">
                  {t("servers:routes.apexHelp")}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="route-port">{t("common:labels.port")}</Label>
              <Select
                items={[
                  ...selectablePorts.map((port) => ({
                    value: String(port.id),
                    label: (
                      <>
                        {port.name}— {port.host}:{port.external_port_start}(
                        {port.http
                          ? t("common:resources.http")
                          : String(port.protocol).toUpperCase()}
                        )
                      </>
                    ),
                  })),
                ]}
                value={portId}
                onValueChange={(value) => setPortId(value ?? "")}
              >
                <SelectTrigger id="route-port" className="w-full">
                  <SelectValue placeholder={t("common:labels.port")} />
                </SelectTrigger>
                <SelectContent>
                  {selectablePorts.map((port) => (
                    <SelectItem key={port.id} value={String(port.id)}>
                      {port.name} — {port.host}:{port.external_port_start} (
                      {port.http
                        ? t("common:resources.http")
                        : String(port.protocol).toUpperCase()}
                      )
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {isHttpRoute
                  ? selectedDomain?.custom
                    ? t("servers:routes.dialog.customHttpRouteHelp")
                    : t("servers:routes.dialog.httpRouteHelp")
                  : t("servers:routes.dialog.rawRouteHelp")}
              </p>
              {selectablePorts.length === 0 ? (
                <p className="text-xs text-destructive">
                  {t("servers:routes.dialog.noSelectablePorts")}
                </p>
              ) : null}
            </div>

            {isHttpRoute ? (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="route-https">
                    {t("common:resources.https")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {(selectedDomain?.https ?? true)
                      ? t("servers:routes.dialog.httpsHelpOn")
                      : t("servers:routes.dialog.httpsHelpOff")}
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
              <p className="rounded-md border p-3 text-xs text-muted-foreground">
                <Trans
                  i18nKey={
                    selectedDomain?.custom
                      ? "servers:routes.dialog.customRecordHelp"
                      : "servers:routes.dialog.createsRecordHelp"
                  }
                  values={{
                    record: `_${srvService}._${srvProtocol}.${
                      isApex && apexAllowed
                        ? ""
                        : `${
                            subdomain ||
                            t("servers:routes.dialog.yourNamePlaceholder")
                          }.`
                    }${
                      selectedDomain?.domain ??
                      t("servers:routes.dialog.theDomainPlaceholder")
                    }`,
                  }}
                  components={{ code: <code className="font-mono" /> }}
                />
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={
                isSubmitting ||
                !subdomainValid ||
                subdomainTooShort ||
                !domainId ||
                !portId
              }
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("servers:routes.dialog.submitButton")}
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
            <AlertDialogTitle>
              {t("servers:routes.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers:routes.deleteDialog.description", {
                fqdn: pendingDelete?.fqdn,
              })}{" "}
              {canBypassLimits
                ? null
                : t("servers:routes.deleteDialog.cooldownNote")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={() => void remove()}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
