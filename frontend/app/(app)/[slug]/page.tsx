import Link from "@/components/link";
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Server, ChevronRight, Clock, Cpu, HardDrive, MemoryStick } from "lucide-react";

import { MainLayout } from "@/components/sidebar/main-layout";
import { useOrganization } from "@/hooks/use-organization";
import { listServers } from "@/lib/api";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, titleCase } from "@/lib/utils";
import { templateBanner } from "@/lib/template-banner";
import {
  DEFAULT_USAGE,
  HIGH_USAGE_THRESHOLD,
  deriveInitialUsage,
  formatUptime,
  statusFromLabel,
  statusLabel,
  statusTone,
  type StatsSnapshot,
} from "@/lib/server-status";

type ServerStatus = {
  state: string;
  started_at?: number | null;
  stats?: StatsSnapshot | null;
};

type ServerListItem = {
  id: string;
  name: string;
  template: string;
  node: string;
  status?: ServerStatus | null;
};

const NO_LIMITS = {
  cpuLimit: null,
  diskLimit: null,
  ramLimit: null,
  swapLimit: null,
};

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
    <div className="min-w-0 space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            high ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
        />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="shrink-0">{label}</span>
        <span
          className={cn(
            "truncate tabular-nums",
            high ? "text-destructive" : "text-foreground",
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
}: {
  slug: string;
  server: ServerListItem;
}) {
  const banner = templateBanner(server.template);
  const state = server.status ? statusFromLabel(server.status.state) : "unknown";
  const tone = statusTone(state);
  const startedAt = server.status?.started_at ?? null;
  const isRunning = state === "running";

  // Reuse the same usage formatting the management bar uses.
  const { usage, percents } = deriveInitialUsage(
    server.status?.stats,
    NO_LIMITS,
    DEFAULT_USAGE,
  );

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
    <Link href={`/${slug}/servers/${server.id}`} className="group block">
      <Card className="relative overflow-hidden rounded-xl border-border/60 py-0 transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md">
        {/* Template banner */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-40"
          style={{
            backgroundImage: banner.gradient,
            maskImage: "linear-gradient(to right, black, transparent)",
            WebkitMaskImage: "linear-gradient(to right, black, transparent)",
          }}
        />
        {/* State accent */}
        <div
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-1", tone.accent)}
        />

        <div className="relative flex flex-col gap-4 py-4 pl-5 pr-4 lg:flex-row lg:items-center lg:gap-6">
          {/* Identity */}
          <div className="flex min-w-0 items-center gap-3 lg:w-72 lg:shrink-0">
            <div className="rounded-lg bg-background/80 p-2 shadow-sm ring-1 ring-border/50 backdrop-blur">
              <Server className="h-4 w-4 text-foreground" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">
                  {server.name}
                </span>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 text-xs font-medium",
                    tone.text,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                  {statusLabel(state)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{titleCase(server.template)}</span>
                {uptime !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {uptime}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Resources */}
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
            <ResourceBar
              icon={Cpu}
              label="CPU"
              value={usage.cpu}
              percent={percents.cpu}
            />
            <ResourceBar
              icon={MemoryStick}
              label="RAM"
              value={usage.ram}
              percent={percents.ram}
            />
            <ResourceBar
              icon={HardDrive}
              label="Disk"
              value={usage.disk}
              percent={percents.disk}
            />
          </div>

          {/* Meta */}
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant="outline" className="bg-background/60 backdrop-blur">
              {server.node}
            </Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </div>
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
            <div className="flex flex-col gap-3">
              {servers.map((server) => (
                <ServerRow key={server.id} slug={slug} server={server} />
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
