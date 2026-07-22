import Link from "@/components/link";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Server, ChevronRight, Clock, Cpu, HardDrive, MemoryStick } from "lucide-react";

import { MainLayout } from "@/components/sidebar/main-layout";
import { useOrganization } from "@/hooks/use-organization";
import {
  useServerStats,
  type ServerLiveState,
} from "@/hooks/use-server-stats";
import { listServers } from "@/lib/api";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn, titleCase } from "@/lib/utils";
import { templateBanner } from "@/lib/template-banner";

const HIGH_USAGE_THRESHOLD = 80;

const STATE_META: Record<
  ServerLiveState,
  { label: string; dot: string; text: string }
> = {
  running: { label: "Running", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  starting: { label: "Starting", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  restarting: { label: "Restarting", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  stopping: { label: "Stopping", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  unhealthy: { label: "Unhealthy", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  stopped: { label: "Stopped", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  locked: { label: "Locked", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

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

function UsageStat({
  icon: Icon,
  label,
  percent,
}: {
  icon: typeof Cpu;
  label: string;
  percent: number | null;
}) {
  const high = percent !== null && percent >= HIGH_USAGE_THRESHOLD;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className={cn("font-medium tabular-nums", high && "text-destructive")}>
          {percent === null ? "--" : `${Math.round(percent)}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
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
  server: { id: string; name: string; template: string; node: string };
}) {
  const stats = useServerStats(server.id, true);
  const banner = templateBanner(server.template);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stats.state !== "running" || stats.startedAt === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [stats.state, stats.startedAt]);

  const stateMeta = STATE_META[stats.state];
  const uptime =
    stats.state === "running" && stats.startedAt !== null
      ? formatUptime(now - stats.startedAt)
      : null;

  return (
    <Link href={`/${slug}/servers/${server.id}`} className="group">
      <Card className="relative h-full overflow-hidden border-border/60 transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md">
        {/* Template banner */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-50"
          style={{
            backgroundImage: banner.gradient,
            maskImage: "linear-gradient(to bottom, black, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
          }}
        />

        <CardHeader className="relative space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-xl bg-background/80 p-2.5 shadow-sm backdrop-blur">
              <HardDrive className="h-5 w-5 text-foreground" />
            </div>

            <div className="flex flex-col items-end gap-2">
              <Badge variant="outline" className="bg-background/70 backdrop-blur">
                Node {server.node}
              </Badge>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium",
                  stateMeta.text,
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", stateMeta.dot)} />
                {stateMeta.label}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <CardTitle className="line-clamp-1 text-lg">{server.name}</CardTitle>
            <CardDescription className="line-clamp-1">
              {titleCase(server.template)}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="relative space-y-4 pt-0">
          {uptime !== null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Uptime {uptime}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <UsageStat icon={Cpu} label="CPU" percent={stats.cpu} />
            <UsageStat icon={MemoryStick} label="RAM" percent={stats.ram} />
            <UsageStat icon={HardDrive} label="Disk" percent={stats.disk} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-sm">
            <span className="truncate text-muted-foreground">
              ID: {server.id}
            </span>

            <span className="inline-flex items-center gap-1 font-medium text-foreground transition-colors group-hover:text-primary">
              Open
              <ChevronRight className="h-4 w-4" />
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
      const res = await listServers({ query: { project: org!.id } });
      return res.error ? [] : (res.data ?? []);
    },
  );

  if (isLoading) return null;

  if (!org) {
    return (
      <MainLayout breadcrumbs={[{ label: slug ?? "" }]}>
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Please select an organization before viewing servers.
            </CardDescription>
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
