import Link from "@/components/link";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import {
  Server,
  ChevronRight,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";

import { MainLayout } from "@/components/sidebar/main-layout";
import {
  useLiveServerStatus,
  type ServerStatusSnapshot,
} from "@/hooks/use-live-server-status";
import { useProject } from "@/hooks/use-project";
import { listServers } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  ServerPermission,
  hasManagementPermission,
  hasServerPermission,
  mergePermissions,
} from "@/lib/permissions";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn, titleCase } from "@/lib/utils";
import { templateBanner } from "@/lib/template-banner";
import {
  HIGH_USAGE_THRESHOLD,
  formatCpuCompact,
  formatUptime,
  formatUsageCompact,
  statusFromLabel,
  statusLabel,
  statusTone,
  usagePercentValue,
} from "@/lib/server-status";
import { useServerTaskLock } from "@/stores/server-tasks";
import { usePowerAction } from "./servers/[server]/components/management-bar/use-power-action";

type ServerListItem = {
  id: string;
  name: string;
  template: string;
  node: string;
  suspended: boolean;
  status?: ServerStatusSnapshot | null;
};

const emptyBarPattern =
  "repeating-linear-gradient(45deg, var(--muted-foreground) 0, var(--muted-foreground) 2px, transparent 2px, transparent 6px)";

function ResourceBar({
  icon: Icon,
  label,
  value,
  percent,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  percent: number | null;
}) {
  const high = percent !== null && percent >= HIGH_USAGE_THRESHOLD;

  return (
    <div className="min-w-0 space-y-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {percent === null ? (
          <div
            aria-hidden
            className="h-full w-full opacity-25"
            style={{ backgroundImage: emptyBarPattern }}
          />
        ) : (
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              high ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <Icon className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium">{label}</span>
        <span
          className={cn(
            "ml-auto truncate text-sm tabular-nums",
            percent === null && "text-muted-foreground",
            high && "font-medium text-destructive",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function ServerRow({
  slug,
  server,
  canPower,
}: {
  slug: string;
  server: ServerListItem;
  canPower: boolean;
}) {
  const { t } = useTranslation();
  const banner = templateBanner(server.template);
  const {
    status: state,
    startedAt,
    stats,
    controls,
  } = useLiveServerStatus(server.id, server.status);
  const power = usePowerAction(server.id);
  const powerLock = useServerTaskLock(server.id, "server", "read");
  const startLock = useServerTaskLock(server.id, "server", "write");
  const tone = statusTone(state);
  const isRunning = state === "running";
  const actionsDisabled = power.pending !== null;
  const stopDisabled = actionsDisabled || !controls.canStop || powerLock.locked;

  const resources = [
    {
      icon: Cpu,
      label: t("common:resources.cpu"),
      value: stats ? formatCpuCompact(stats.cpu, stats.cpu_max) : "-- / --",
      percent: stats ? usagePercentValue(stats.cpu, stats.cpu_max) : null,
    },
    {
      icon: MemoryStick,
      label: t("project:shared.ram"),
      value: stats ? formatUsageCompact(stats.ram, stats.ram_max) : "-- / --",
      percent: stats ? usagePercentValue(stats.ram, stats.ram_max) : null,
    },
    {
      icon: HardDrive,
      label: t("common:resources.disk"),
      value: stats ? formatUsageCompact(stats.disk, stats.disk_max) : "-- / --",
      percent: stats ? usagePercentValue(stats.disk, stats.disk_max) : null,
    },
  ];

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning || startedAt === null) return;
    const tick = () => setNow(Date.now());
    const immediate = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [isRunning, startedAt]);

  const uptime = startedAt !== null ? formatUptime(now - startedAt) : null;

  return (
    <ContextMenu disabled={!canPower}>
      <ContextMenuTrigger className="block">
        <Link href={`/${slug}/servers/${server.id}`} className="group block">
          <Card className="relative overflow-hidden rounded-2xl border-border/60 py-0 transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1/4 opacity-[0.14]"
              style={{
                backgroundImage: banner.gradient,
                maskImage: "linear-gradient(to right, black, transparent)",
                WebkitMaskImage:
                  "linear-gradient(to right, black, transparent)",
              }}
            />

            <div className="relative flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center lg:gap-8">
              <div className="flex min-w-0 items-center gap-3.5 lg:w-72 lg:shrink-0">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background/80 shadow-sm ring-1 ring-border/60 backdrop-blur">
                  <Server className="size-5 text-foreground" />
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold">
                      {server.name}
                    </span>

                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 text-sm",
                        tone.text,
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", tone.dot)} />
                      {statusLabel(state)}
                    </span>

                    {server.suspended && (
                      <Badge variant="destructive" className="shrink-0">
                        {t("common:status.suspended")}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="truncate">
                      {titleCase(server.template)}
                    </span>
                    {uptime !== null && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Clock className="size-3.5" />
                          {uptime}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
                {resources.map((resource) => (
                  <ResourceBar
                    key={resource.label}
                    icon={resource.icon}
                    label={resource.label}
                    value={resource.value}
                    percent={resource.percent}
                  />
                ))}
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-start">
                <span className="rounded-full bg-muted/80 px-3 py-1 font-mono text-xs text-muted-foreground">
                  {server.node}
                </span>
                <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </div>
          </Card>
        </Link>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          disabled={actionsDisabled || !controls.canStart || startLock.locked}
          onClick={() => void power.execute("start")}
        >
          <Play />
          {t("common:resources.start")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={stopDisabled}
          onClick={() => void power.execute("restart")}
        >
          <RotateCcw />
          {t("servers:managementBar.actions.restart")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={stopDisabled}
          onClick={() => void power.execute("stop")}
        >
          <Pause />
          {t("servers:managementBar.actions.stop")}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={actionsDisabled || !controls.canKill || powerLock.locked}
          onClick={() => void power.execute("kill")}
        >
          <ShieldAlert />
          {t("servers:managementBar.actions.kill")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function ProjectPage() {
  const { t } = useTranslation();
  const { slug = "" } = useParams<{ slug: string }>();

  const { data: project, isLoading } = useProject(slug);
  const { data: session } = authClient.useSession();

  const { data: serversData } = useSWR(
    project ? ["servers", project.id] : null,
    async ([, projectId]) => {
      const res = await listServers({
        query: { project: projectId, include: true },
      });
      return res.error ? [] : (res.data ?? []);
    },
    { refreshInterval: 30000 },
  );

  if (isLoading) return null;

  if (!project) {
    return (
      <MainLayout breadcrumbs={[{ label: slug ?? "" }]}>
        <Card>
          <CardHeader>
            <CardTitle>{t("project:dashboard.noProjectTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("project:dashboard.noProjectDescription")}
            </p>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  const servers = serversData ?? [];
  const effectivePermissions = mergePermissions(
    session?.user.permissions ?? 0,
    project.permissions,
  );
  const hasPowerPermission = hasServerPermission(
    effectivePermissions,
    ServerPermission.POWER,
  );
  const bypassesSuspension =
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.SERVER_SUSPEND,
    ) ||
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.LIMITS_BYPASS,
    );

  return (
    <MainLayout
      breadcrumbs={[{ label: slug }, { label: t("common:nav.servers") }]}
    >
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-semibold tracking-tight">
            {t("project:dashboard.heading")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("project:dashboard.subheading")}
          </p>
        </div>

        {/* Server List */}
        <div className="flex flex-col gap-4">
          {servers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-4 py-14 text-center">
                <div className="rounded-2xl bg-muted p-4">
                  <Server className="h-6 w-6 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-base font-medium">
                    {t("project:dashboard.emptyTitle")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("project:dashboard.emptyDescription")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {servers.map((server) => (
                <ServerRow
                  key={server.id}
                  slug={slug}
                  server={server}
                  canPower={
                    hasPowerPermission &&
                    (!server.suspended || bypassesSuspension)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
