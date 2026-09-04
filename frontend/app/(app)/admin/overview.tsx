import { useMemo } from "react";
import {
  Boxes,
  CheckCircle2,
  ChevronRight,
  Database,
  FolderKanban,
  Globe,
  Globe2,
  KeyRound,
  Network,
  Server,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

import Link from "@/components/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  integrityReport,
  listAllApiKeys,
  listDatabaseHostRegistrations,
  listDatabaseHosts,
  listNodeRegistrations,
  listNodes,
  listProjects,
  listRegions,
  listRouteDomainsAdmin,
  listServers,
  listTemplateUsage,
  listUsers,
} from "@/lib/api";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";

function useList<T>(key: string | null, load: () => Promise<T[]>) {
  return useSWR(key, load).data;
}

function StatCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  hint: string | undefined;
}) {
  return (
    <Link href={href}>
      <Card className="h-full gap-0 py-0 transition-colors hover:border-primary/40 hover:bg-accent/40">
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            {value === undefined ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
            )}
            <p className="text-xs text-muted-foreground">{hint ?? " "}</p>
          </div>
          <Icon className="size-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

function AttentionRow({
  href,
  icon: Icon,
  text,
}: {
  href: string;
  icon: LucideIcon;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/40"
    >
      <Icon className="size-4 shrink-0 text-amber-500" />
      <span className="flex-1">{text}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function AdminOverview({ permissions }: { permissions: number }) {
  const { t } = useTranslation();

  const can = (permission: number) =>
    hasManagementPermission(permissions, permission);

  const canViewUsers = can(ManagementPermission.USER_VIEW);
  const canViewApiKeys = can(ManagementPermission.API_KEYS_VIEW);
  const canViewNodes = can(ManagementPermission.NODES_VIEW);
  const canViewDomains = can(ManagementPermission.DOMAINS_VIEW);
  const canViewDatabases = can(ManagementPermission.DATABASE_HOSTS_VIEW);
  const canViewIntegrity = can(ManagementPermission.INTEGRITY_VIEW);
  const canManageServers = can(ManagementPermission.SERVER_MANAGE);

  const projects = useList("admin/projects", async () => {
    const response = await listProjects();
    return response.error ? [] : (response.data ?? []);
  });

  const servers = useList("admin/servers", async () => {
    const response = await listServers();
    return response.error ? [] : (response.data ?? []);
  });

  const users = useList(canViewUsers ? "admin/users" : null, async () => {
    const response = await listUsers();
    return response.error ? [] : (response.data ?? []);
  });

  const apiKeys = useList(
    canViewApiKeys ? "admin/api-keys" : null,
    async () => {
      const response = await listAllApiKeys();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const nodes = useList(canViewNodes ? "admin/nodes" : null, async () => {
    const response = await listNodes();
    return response.error ? [] : (response.data ?? []);
  });

  const regions = useList(canViewNodes ? "admin/regions" : null, async () => {
    const response = await listRegions();
    return response.error ? [] : (response.data ?? []);
  });

  const nodeRegistrations = useList(
    canViewNodes ? "admin/node/registrations" : null,
    async () => {
      const response = await listNodeRegistrations();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const domains = useList(canViewDomains ? "admin/domains" : null, async () => {
    const response = await listRouteDomainsAdmin();
    return response.error ? [] : (response.data ?? []);
  });

  const hosts = useList(
    canViewDatabases ? "admin/database-hosts" : null,
    async () => {
      const response = await listDatabaseHosts();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const hostRegistrations = useList(
    canViewDatabases ? "admin/database-host/registrations" : null,
    async () => {
      const response = await listDatabaseHostRegistrations();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const templates = useList(
    canManageServers ? "admin/templates" : null,
    async () => {
      const response = await listTemplateUsage();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const { data: integrity } = useSWR(
    canViewIntegrity ? "admin/integrity/summary" : null,
    async () => {
      const response = await integrityReport();
      return response.error ? null : (response.data ?? null);
    },
  );

  const stats = useMemo(
    () => ({
      admins: users?.filter((user) => user.role === 2).length,
      owners: projects
        ? new Set(projects.map((project) => project.owner)).size
        : undefined,
      serverNodes: servers
        ? new Set(servers.map((server) => server.node)).size
        : undefined,
      instanceKeys: apiKeys?.filter((key) => !key.project).length,
      maintenanceNodes: nodes?.filter((node) => node.maintenance).length,
      instances: hosts?.reduce((total, host) => total + host.instance_count, 0),
      maintenanceHosts: hosts?.filter((host) => host.maintenance).length,
      routes: domains?.reduce((total, domain) => total + domain.routes, 0),
      usedTemplates: templates?.filter((template) => template.servers > 0)
        .length,
    }),
    [users, projects, servers, apiKeys, nodes, hosts, domains, templates],
  );

  const attention = [
    nodeRegistrations?.length
      ? {
          key: "nodeRegistrations",
          href: "/admin/nodes",
          icon: Network,
          text: t("admin-core:overview.attention.nodeRegistrations", {
            count: nodeRegistrations.length,
          }),
        }
      : null,
    hostRegistrations?.length
      ? {
          key: "hostRegistrations",
          href: "/admin/databases",
          icon: Database,
          text: t("admin-core:overview.attention.hostRegistrations", {
            count: hostRegistrations.length,
          }),
        }
      : null,
    stats.maintenanceNodes
      ? {
          key: "maintenanceNodes",
          href: "/admin/nodes",
          icon: Wrench,
          text: t("admin-core:overview.attention.maintenanceNodes", {
            count: stats.maintenanceNodes,
          }),
        }
      : null,
    stats.maintenanceHosts
      ? {
          key: "maintenanceHosts",
          href: "/admin/databases",
          icon: Wrench,
          text: t("admin-core:overview.attention.maintenanceHosts", {
            count: stats.maintenanceHosts,
          }),
        }
      : null,
    integrity &&
    (integrity.severity === "error" || integrity.severity === "warning")
      ? {
          key: "integrity",
          href: "/admin/integrity",
          icon: ShieldCheck,
          text: t(
            `admin-core:overview.attention.integrity.${integrity.severity}`,
          ),
        }
      : null,
  ].filter((item) => item !== null);

  const cards = [
    {
      key: "projects",
      href: "/admin/projects",
      icon: FolderKanban,
      label: t("common:nav.projects"),
      value: projects?.length,
      hint:
        stats.owners === undefined
          ? undefined
          : t("admin-core:overview.hints.owners", { count: stats.owners }),
    },
    {
      key: "servers",
      href: "/admin/servers",
      icon: Server,
      label: t("common:nav.servers"),
      value: servers?.length,
      hint:
        stats.serverNodes === undefined
          ? undefined
          : t("admin-core:overview.hints.serverNodes", {
              count: stats.serverNodes,
            }),
    },
    canViewUsers
      ? {
          key: "users",
          href: "/admin/users",
          icon: Users,
          label: t("common:nav.users"),
          value: users?.length,
          hint:
            stats.admins === undefined
              ? undefined
              : t("admin-core:overview.hints.admins", { count: stats.admins }),
        }
      : null,
    canViewApiKeys
      ? {
          key: "api-keys",
          href: "/admin/api-keys",
          icon: KeyRound,
          label: t("common:nav.apiKeys"),
          value: apiKeys?.length,
          hint:
            stats.instanceKeys === undefined
              ? undefined
              : t("admin-core:overview.hints.instanceKeys", {
                  count: stats.instanceKeys,
                }),
        }
      : null,
    canViewNodes
      ? {
          key: "nodes",
          href: "/admin/nodes",
          icon: Network,
          label: t("common:nav.nodes"),
          value: nodes?.length,
          hint:
            stats.maintenanceNodes === undefined
              ? undefined
              : t("admin-core:overview.hints.maintenance", {
                  count: stats.maintenanceNodes,
                }),
        }
      : null,
    canViewNodes
      ? {
          key: "regions",
          href: "/admin/regions",
          icon: Globe2,
          label: t("common:nav.regions"),
          value: regions?.length,
          hint: undefined,
        }
      : null,
    canViewDatabases
      ? {
          key: "databases",
          href: "/admin/databases",
          icon: Database,
          label: t("common:nav.databases"),
          value: hosts?.length,
          hint:
            stats.instances === undefined
              ? undefined
              : t("admin-core:overview.hints.instances", {
                  count: stats.instances,
                }),
        }
      : null,
    canViewDomains
      ? {
          key: "domains",
          href: "/admin/domains",
          icon: Globe,
          label: t("navigation:adminSidebar.items.domains"),
          value: domains?.length,
          hint:
            stats.routes === undefined
              ? undefined
              : t("admin-core:overview.hints.routes", { count: stats.routes }),
        }
      : null,
    canManageServers
      ? {
          key: "templates",
          href: "/admin/templates",
          icon: Boxes,
          label: t("common:nav.templates"),
          value: templates?.length,
          hint:
            stats.usedTemplates === undefined
              ? undefined
              : t("admin-core:overview.hints.usedTemplates", {
                  count: stats.usedTemplates,
                }),
        }
      : null,
  ].filter((card) => card !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">
          {t("admin-core:overview.title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("admin-core:overview.description")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.key}
            href={card.href}
            icon={card.icon}
            label={card.label}
            value={card.value}
            hint={card.hint}
          />
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">
          {t("admin-core:overview.attention.title")}
        </h2>
        <div className="divide-y overflow-hidden rounded-lg border">
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              {t("admin-core:overview.attention.empty")}
            </div>
          ) : (
            attention.map((item) => (
              <AttentionRow
                key={item.key}
                href={item.href}
                icon={item.icon}
                text={item.text}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
