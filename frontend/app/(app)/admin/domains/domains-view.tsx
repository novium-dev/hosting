"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Plus, RefreshCcw, Trash2, X } from "lucide-react";
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
  allowDomainProject,
  createRouteDomain,
  deleteRouteDomain,
  denyDomainProject,
  listProjects,
  listRouteDomainsAdmin,
  resolveDomainZone,
  routeBackends,
  updateRouteDomain,
  type ListRouteDomainsAdminResponse,
} from "@/lib/api";
import {
  ManagementPermission,
  hasManagementPermission,
} from "@/lib/permissions";
import { authClient } from "@/lib/auth-client";

type Domain = ListRouteDomainsAdminResponse[number];

function errorMessage(
  error: { error?: { msg?: string } } | undefined,
  fallback: string,
) {
  return error?.error?.msg ?? fallback;
}

export function AdminDomainsView() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const canManage = hasManagementPermission(
    session?.user.permissions ?? 0,
    ManagementPermission.DOMAINS_MANAGE,
  );

  const {
    data: domains,
    isLoading,
    mutate,
  } = useSWR("admin-route-domains", async () => {
    const response = await listRouteDomainsAdmin();
    if (response.error) {
      throw new Error(
        errorMessage(response.error, t("admin-core:domains.toast.loadFailed")),
      );
    }
    return response.data ?? [];
  });

  const { data: backends } = useSWR("admin-route-backends", async () => {
    const response = await routeBackends();
    return response.data ?? { cloudflare: false, pangolin: false };
  });

  const { data: projects } = useSWR("admin-route-projects", async () => {
    const response = await listProjects();
    return response.data ?? [];
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Domain | null>(null);
  const [grantTarget, setGrantTarget] = useState<Domain | null>(null);
  const [grantProject, setGrantProject] = useState("");

  const [domain, setDomain] = useState("");
  const [pangolinDomainId, setPangolinDomainId] = useState("");
  const [https, setHttps] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);

  const projectName = (id: string) =>
    projects?.find((project) => project.id === id)?.slug ?? id;

  const openCreate = () => {
    setDomain("");
    setPangolinDomainId("");
    setHttps(true);
    setIsPrivate(false);
    setCreateOpen(true);
  };

  const submit = async () => {
    if (!domain) return;

    setIsSubmitting(true);

    try {
      const response = await createRouteDomain({
        body: {
          domain,
          pangolin_domain_id: pangolinDomainId || null,
          https,
          private: isPrivate,
        },
      });

      if (response.error) {
        throw new Error(
          errorMessage(response.error, t("admin-core:domains.toast.addFailed")),
        );
      }

      toast.success(t("admin-core:domains.toast.added", { domain }));
      setCreateOpen(false);
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin-core:domains.toast.addFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggle = async (
    entry: Domain,
    patch: { https?: boolean; private?: boolean },
  ) => {
    try {
      const response = await updateRouteDomain({
        path: { domain_id: entry.id },
        body: patch,
      });

      if (response.error) {
        throw new Error(
          errorMessage(
            response.error,
            t("admin-core:domains.toast.updateFailed"),
          ),
        );
      }

      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin-core:domains.toast.updateFailed"),
      );
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;

    setIsSubmitting(true);

    try {
      const response = await deleteRouteDomain({
        path: { domain_id: pendingDelete.id },
      });

      if (response.error) {
        throw new Error(
          errorMessage(
            response.error,
            t("admin-core:domains.toast.deleteFailed"),
          ),
        );
      }

      toast.success(t("admin-core:domains.toast.deleted"));
      setPendingDelete(null);
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin-core:domains.toast.deleteFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const grant = async () => {
    if (!grantTarget || !grantProject) return;

    setIsSubmitting(true);

    try {
      const response = await allowDomainProject({
        path: { domain_id: grantTarget.id, project_id: grantProject },
      });

      if (response.error) {
        throw new Error(
          errorMessage(
            response.error,
            t("admin-core:domains.toast.grantFailed"),
          ),
        );
      }

      setGrantTarget(null);
      setGrantProject("");
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin-core:domains.toast.grantFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const resolveZone = async (entry: Domain) => {
    setIsSubmitting(true);

    try {
      const response = await resolveDomainZone({
        path: { domain_id: entry.id },
      });

      if (response.error) {
        throw new Error(
          errorMessage(
            response.error,
            t("admin-core:domains.toast.resolveFailed"),
          ),
        );
      }

      toast.success(
        t("admin-core:domains.toast.zoneResolved", { domain: entry.domain }),
      );
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin-core:domains.toast.resolveFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const revoke = async (entry: Domain, project: string) => {
    try {
      const response = await denyDomainProject({
        path: { domain_id: entry.id, project_id: project },
      });

      if (response.error) {
        throw new Error(
          errorMessage(
            response.error,
            t("admin-core:domains.toast.revokeFailed"),
          ),
        );
      }

      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin-core:domains.toast.revokeFailed"),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold">
            {t("admin-core:domains.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-core:domains.description")}
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" />
            {t("admin-core:domains.newDomain")}
          </Button>
        ) : null}
      </div>

      {backends && !backends.cloudflare && !backends.pangolin ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <Trans
            i18nKey="admin-core:domains.backendNotConfigured"
            components={{
              code1: <code className="mx-1 font-mono" />,
              code2: <code className="mx-1 font-mono" />,
            }}
          />
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (domains?.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("admin-core:domains.emptyState")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin-core:domains.table.domain")}</TableHead>
                <TableHead>{t("admin-core:domains.table.carries")}</TableHead>
                <TableHead>{t("common:resources.https")}</TableHead>
                <TableHead>{t("admin-core:domains.table.private")}</TableHead>
                <TableHead>{t("common:nav.projects")}</TableHead>
                <TableHead>{t("admin-core:domains.table.routes")}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.domain}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {entry.http_available ? (
                        <Badge>{t("common:resources.http")}</Badge>
                      ) : null}
                      {entry.tcp_available ? (
                        <Badge title={entry.cloudflare_zone_id ?? undefined}>
                          {t("admin-core:domains.table.tcpBadge")}
                        </Badge>
                      ) : null}
                      {!entry.http_available && !entry.tcp_available ? (
                        <span className="text-sm text-muted-foreground">
                          {t("admin-core:domains.table.nothingYet")}
                        </span>
                      ) : null}
                      {canManage &&
                      backends?.cloudflare &&
                      !entry.cloudflare_zone_id ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isSubmitting}
                          onClick={() => void resolveZone(entry)}
                        >
                          <RefreshCcw className="size-3" />
                          {t("admin-core:domains.findZone")}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={entry.https}
                      disabled={!canManage}
                      onCheckedChange={(value) =>
                        void toggle(entry, { https: value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={entry.private}
                      disabled={!canManage}
                      onCheckedChange={(value) =>
                        void toggle(entry, { private: value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {
                      // only if private
                      entry.private ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {entry.projects.map((project) => (
                            <Badge
                              key={project}
                              variant="secondary"
                              className="gap-1"
                            >
                              {projectName(project)}
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={() => void revoke(entry, project)}
                                >
                                  <X className="size-3" />
                                </button>
                              ) : null}
                            </Badge>
                          ))}
                          {canManage ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setGrantTarget(entry);
                                setGrantProject("");
                              }}
                            >
                              <Plus className="size-3" />
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t("admin-core:domains.allProjects")}
                        </p>
                      )
                    }
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {entry.routes}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setPendingDelete(entry)}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin-core:domains.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("admin-core:domains.createDialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="domain-name">
                {t("admin-core:domains.table.domain")}
              </Label>
              <Input
                id="domain-name"
                value={domain}
                placeholder={t("admin-core:domains.createDialog.domainPlaceholder")}
                autoComplete="off"
                onChange={(event) =>
                  setDomain(event.target.value.trim().toLowerCase())
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain-pangolin-id">
                {t("admin-core:domains.createDialog.pangolinIdLabel")}
              </Label>
              <Input
                id="domain-pangolin-id"
                value={pangolinDomainId}
                autoComplete="off"
                onChange={(event) => setPangolinDomainId(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin-core:domains.createDialog.pangolinIdHelp")}
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="domain-https">
                  {t("common:resources.https")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin-core:domains.createDialog.httpsHelp")}
                </p>
              </div>
              <Switch
                id="domain-https"
                checked={https}
                onCheckedChange={setHttps}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="domain-private">
                  {t("admin-core:domains.table.private")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("admin-core:domains.createDialog.privateHelp")}
                </p>
              </div>
              <Switch
                id="domain-private"
                checked={isPrivate}
                onCheckedChange={setIsPrivate}
              />
            </div>
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
              disabled={isSubmitting || !domain}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("admin-core:domains.createDialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={grantTarget !== null}
        onOpenChange={(open) => {
          if (!open) setGrantTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin-core:domains.grantDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("admin-core:domains.grantDialog.description", {
                domain: grantTarget?.domain,
              })}
            </DialogDescription>
          </DialogHeader>

          <Select value={grantProject} onValueChange={setGrantProject}>
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t("admin-core:domains.grantDialog.projectPlaceholder")}
              />
            </SelectTrigger>
            <SelectContent>
              {projects
                ?.filter(
                  (project) => !grantTarget?.projects.includes(project.id),
                )
                .map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} ({project.slug})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGrantTarget(null)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void grant()}
              disabled={isSubmitting || !grantProject}
            >
              {t("admin-core:domains.grantDialog.submit")}
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
              {t("admin-core:domains.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-core:domains.deleteDialog.description", {
                domain: pendingDelete?.domain,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
