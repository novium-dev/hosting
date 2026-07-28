import Link from "@/components/link";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  Server,
  ArrowUpRight,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
} from "lucide-react";

import { MainLayout } from "@/components/sidebar/main-layout";
import { useOrganization } from "@/hooks/use-organization";
import { listServers } from "@/lib/api";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, titleCase } from "@/lib/utils";
import { templateBanner } from "@/lib/template-banner";

const HIGH_USAGE_THRESHOLD = 80;

type ServerStats = {
  cpu?: number | null;
  cpu_max?: number | null;
  ram?: number | null;
  ram_max?: number | null;
  disk?: number | null;
  disk_max?: number | null;
};

type ServerStatus = {
  state: string;
  started_at?: number | null;
  stats?: ServerStats | null;
};

type ServerListItem = {
  id: string;
  name: string;
  template: string;
  node: string;
  status?: ServerStatus | null;
};

function stateMeta(state: string | undefined): {
  label: string;
  dot: string;
  text: string;
} {
  const normalized = (state ?? "").trim().toLowerCase();
  if (["running", "online"].includes(normalized))
    return {
      label: "Running",
      dot: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
    };
  if (normalized.includes("unhealthy"))
    return {
      label: "Unhealthy",
      dot: "bg-red-500",
      text: "text-red-600 dark:text-red-400",
    };
  if (
    normalized.includes("starting") ||
    normalized.includes("stopping") ||
    normalized.includes("restarting")
  )
    return {
      label: state ?? "Unknown",
      dot: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    };
  if (["stopped", "offline", "crashed"].includes(normalized))
    return {
      label: "Stopped",
      dot: "bg-muted-foreground/50",
      text: "text-muted-foreground",
    };
  if (!normalized)
    return {
      label: "Unknown",
      dot: "bg-muted-foreground/40",
      text: "text-muted-foreground",
    };
  return {
    label: state ?? "Unknown",
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
  };
}

function formatUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

/** Formats a current/max pair (both in MiB) picking a shared unit off the max. */
function formatMemPair(
  current: number | null | undefined,
  max: number | null | undefined,
): string {
  if (max == null || max <= 0) {
    return current != null ? `${Math.round(current)} MiB` : "--";
  }
  const useGiB = max >= 1024;
  const div = useGiB ? 1024 : 1;
  const unit = useGiB ? "GiB" : "MiB";
  const decimals = useGiB ? 1 : 0;
  const c = current != null ? (current / div).toFixed(decimals) : "--";
  const m = (max / div).toFixed(decimals);
  return `${c} / ${m} ${unit}`;
}

function formatCpuPair(
  current: number | null | undefined,
  max: number | null | undefined,
): string {
  const c = current != null ? current.toFixed(1) : "--";
  if (max == null || max <= 0) return `${c} vCPU`;
  const m = max % 1 === 0 ? max.toFixed(0) : max.toFixed(1);
  return `${c} / ${m} vCPU`;
}

function percentOf(
  current: number | null | undefined,
  max: number | null | undefined,
): number | null {
  if (current == null || max == null || max <= 0) return null;
  return (current / max) * 100;
}

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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span
          className={cn(
            "tabular-nums font-medium",
            high ? "text-destructive" : "text-foreground",
          )}
        >
          {value}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            high ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
        />
      </div>
    </div>
  );
}

function ServerCard({
  slug,
  server,
}: {
  slug: string;
  server: ServerListItem;
}) {
  const banner = templateBanner(server.template);
  const meta = stateMeta(server.status?.state);
  const startedAt = server.status?.started_at ?? null;
  const stats = server.status?.stats ?? null;
  const isRunning = meta.label === "Running";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning || startedAt === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  const uptime =
    isRunning && startedAt !== null ? formatUptime(now - startedAt) : null;

  return (
    <Link href={`/${slug}/servers/${server.id}`} className="group">
      <Card className="relative flex h-full flex-col overflow-hidden rounded-2xl border-border/60 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-lg">
        {/* Template banner */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-50"
          style={{
            backgroundImage: banner.gradient,
            maskImage: "linear-gradient(to bottom, black, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
          }}
        />

        <CardHeader className="relative gap-4 p-6 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-2xl bg-background/80 p-3 shadow-sm ring-1 ring-border/50 backdrop-blur">
              <Server className="h-6 w-6 text-foreground" />
            </div>

            <div className="flex flex-col items-end gap-2">
              {server.status ? (
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-border/50 backdrop-blur",
                    meta.text,
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                  {meta.label}
                </span>
              ) : null}
              <Badge
                variant="outline"
                className="bg-background/60 backdrop-blur"
              >
                Node {server.node}
              </Badge>
            </div>
          </div>

          <div className="space-y-1">
            <CardTitle className="line-clamp-1 text-xl">
              {server.name}
            </CardTitle>
            <p className="line-clamp-1 text-sm text-muted-foreground">
              {titleCase(server.template)}
            </p>
          </div>
        </CardHeader>

        <CardContent className="relative mt-auto flex flex-col gap-5 p-6 pt-5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>{uptime !== null ? `Uptime ${uptime}` : "Not running"}</span>
          </div>

          <div className="space-y-3">
            <ResourceBar
              icon={Cpu}
              label="CPU"
              value={formatCpuPair(stats?.cpu, stats?.cpu_max)}
              percent={percentOf(stats?.cpu, stats?.cpu_max)}
            />
            <ResourceBar
              icon={MemoryStick}
              label="Memory"
              value={formatMemPair(stats?.ram, stats?.ram_max)}
              percent={percentOf(stats?.ram, stats?.ram_max)}
            />
            <ResourceBar
              icon={HardDrive}
              label="Disk"
              value={formatMemPair(stats?.disk, stats?.disk_max)}
              percent={percentOf(stats?.disk, stats?.disk_max)}
            />
          </div>

          <div className="flex items-center justify-end border-t border-border/60 pt-3 text-sm font-medium text-muted-foreground transition-colors group-hover:text-primary">
            <span className="inline-flex items-center gap-1">
              Manage
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function OrganizationPage() {
  const { slug = "" } = useParams<{ slug: string }>();

  const { data: org, isLoading } = useOrganization(slug);

  const { data: serversData } = useSWR(
    org ? ["servers", org.id] : null,
    async () => {
      const res = await listServers({
        query: { project: org!.id, include: true },
      });
      return res.error ? [] : (res.data ?? []);
    },
    { refreshInterval: 5000 },
  );

  if (isLoading) return null;

  if (!org) {
    return (
      <MainLayout breadcrumbs={[{ label: slug ?? "" }]}>
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <p className="text-sm text-muted-foreground">
              Please select an organization before viewing servers.
            </p>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  const servers = serversData ?? [];

  return (
    <MainLayout breadcrumbs={[{ label: slug }, { label: "Servers" }]}>
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <p className="text-3xl font-semibold tracking-tight">Your Servers</p>
          <p className="text-sm text-muted-foreground">
            Manage your game servers, view logs, and access the console.
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
                  <p className="text-base font-medium">No servers found</p>
                  <p className="text-sm text-muted-foreground">
                    This organization doesn&apos;t have any game servers yet.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {servers.map((server) => (
                <ServerCard key={server.id} slug={slug} server={server} />
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
