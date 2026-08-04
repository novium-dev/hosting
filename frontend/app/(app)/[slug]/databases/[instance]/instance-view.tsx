"use client";

import useSWR from "swr";

import { powerInstanceAction } from "@/actions/databases";
import { DATABASE_TYPE_LABELS } from "@/components/databases/database-type";
import { InstanceDatabases } from "@/components/databases/instance-databases";
import { InstanceUsers } from "@/components/databases/instance-users";
import Link from "@/components/link";
import { NotFoundView } from "@/components/not-found-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAction } from "@/lib/action-hooks";
import { listProjectInstances } from "@/lib/api";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { Play, RotateCw, Square } from "lucide-react";
import { toast } from "sonner";

function formatMib(value: number | null | undefined) {
  if (!value) return "—";
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${value} MiB`;
}

export function InstanceView({
  projectId,
  slug,
  instanceId,
  permissions,
}: {
  projectId: string;
  slug: string;
  instanceId: string;
  permissions: number;
}) {
  const { data: instances, isLoading, mutate } = useSWR(
    ["project-instances", projectId],
    async () => {
      const response = await listProjectInstances({
        path: { project_id: projectId },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load instances");
      }
      return response.data ?? [];
    },
  );

  const canManage = hasServerPermission(
    permissions,
    ServerPermission.DATABASE_MANAGE,
  );

  const power = useAction(powerInstanceAction, {
    onSuccess: () => {
      toast.success("Power state changed");
      void mutate();
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ?? "Failed to change the power state",
      );
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const instance = instances?.find((candidate) => candidate.id === instanceId);
  if (!instance) return <NotFoundView />;

  const running = instance.state === "running";

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/${slug}/databases`} className="hover:underline">
              Databases
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{instance.display}</h1>
            <Badge variant="secondary">
              {DATABASE_TYPE_LABELS[instance.type]}
            </Badge>
            {instance.suspended ? (
              <Badge variant="destructive">Suspended</Badge>
            ) : running ? (
              <Badge>Running</Badge>
            ) : (
              <Badge variant="outline">{instance.state}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">
              {instance.host}:{instance.port}
            </span>
            {" · "}
            {formatMib(instance.memory_limit)} memory
            {" · "}
            {formatMib(instance.disk_limit)} disk
          </p>
        </div>

        {canManage ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void power.executeAsync({
                  projectId,
                  instanceId,
                  action: running ? "stop" : "start",
                })
              }
            >
              {running ? (
                <Square className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {running ? "Stop" : "Start"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void power.executeAsync({
                  projectId,
                  instanceId,
                  action: "restart",
                })
              }
            >
              <RotateCw className="size-4" />
              Restart
            </Button>
          </div>
        ) : null}
      </div>

      {!running && !instance.suspended ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          The instance is not running. Start it before creating databases or
          users — the engine has to be up for those to take effect.
        </p>
      ) : null}

      <InstanceDatabases
        projectId={projectId}
        instanceId={instanceId}
        canManage={canManage}
      />
      <InstanceUsers
        projectId={projectId}
        instanceId={instanceId}
        canManage={canManage}
      />
    </div>
  );
}
