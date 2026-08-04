"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Plus, Trash2, X } from "lucide-react";
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
      throw new Error(errorMessage(response.error, "Failed to load domains"));
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
        throw new Error(errorMessage(response.error, "Failed to add domain"));
      }

      toast.success(`${domain} added`);
      setCreateOpen(false);
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add domain",
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
          errorMessage(response.error, "Failed to update domain"),
        );
      }

      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update domain",
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
          errorMessage(response.error, "Failed to delete domain"),
        );
      }

      toast.success("Domain deleted");
      setPendingDelete(null);
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete domain",
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
        throw new Error(errorMessage(response.error, "Failed to grant access"));
      }

      setGrantTarget(null);
      setGrantProject("");
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to grant access",
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
          errorMessage(response.error, "Failed to revoke access"),
        );
      }

      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to revoke access",
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold">Domains</h1>
          <p className="text-sm text-muted-foreground">
            Domains users can put their routes under. HTTP ports become Pangolin
            resources, TCP ports get a Cloudflare SRV record. A private domain
            is only offered to the projects you grant it to.
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" />
            New domain
          </Button>
        ) : null}
      </div>

      {backends && !backends.cloudflare && !backends.pangolin ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Neither route backend is configured. Add
          <code className="mx-1 font-mono">[routes.cloudflare]</code>
          for TCP routes (SRV records) or
          <code className="mx-1 font-mono">[routes.pangolin]</code>
          for HTTP routes to the backend config.
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (domains?.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No domains yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Carries</TableHead>
                <TableHead>HTTPS</TableHead>
                <TableHead>Private</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead>Routes</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.domain}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {entry.http_available ? <Badge>HTTP</Badge> : null}
                      {entry.tcp_available ? <Badge>TCP</Badge> : null}
                      {!entry.http_available && !entry.tcp_available ? (
                        <span className="text-sm text-muted-foreground">
                          nothing yet
                        </span>
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
                          All projects
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
            <DialogTitle>New domain</DialogTitle>
            <DialogDescription>
              Routes are created as subdomains of this domain.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="domain-name">Domain</Label>
              <Input
                id="domain-name"
                value={domain}
                placeholder="novium.link"
                autoComplete="off"
                onChange={(event) =>
                  setDomain(event.target.value.trim().toLowerCase())
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain-pangolin-id">Pangolin domain ID</Label>
              <Input
                id="domain-pangolin-id"
                value={pangolinDomainId}
                autoComplete="off"
                onChange={(event) => setPangolinDomainId(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The domain&apos;s ID in Pangolin. Required for HTTP routes; TCP
                routes go through Cloudflare and do not need it.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="domain-https">HTTPS</Label>
                <p className="text-xs text-muted-foreground">
                  Users may enable HTTPS for HTTP routes on this domain.
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
                <Label htmlFor="domain-private">Private</Label>
                <p className="text-xs text-muted-foreground">
                  Only granted projects see this domain.
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={isSubmitting || !domain}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Add domain
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
            <DialogTitle>Grant project access</DialogTitle>
            <DialogDescription>
              Pick the project that may use {grantTarget?.domain}.
            </DialogDescription>
          </DialogHeader>

          <Select value={grantProject} onValueChange={setGrantProject}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Project" />
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void grant()}
              disabled={isSubmitting || !grantProject}
            >
              Grant
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
            <AlertDialogTitle>Delete domain</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.domain} can no longer be used for new routes. A
              domain that still has routes cannot be deleted.
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
