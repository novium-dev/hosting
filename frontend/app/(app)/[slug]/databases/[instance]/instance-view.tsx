"use client";

import { useState } from "react";
import { Table2, UserRound } from "lucide-react";
import useSWR from "swr";

import { InstanceDatabases } from "@/components/databases/instance-databases";
import { InstanceManagementBar } from "@/components/databases/instance-management-bar";
import { InstanceUsers } from "@/components/databases/instance-users";
import Link from "@/components/link";
import { NotFoundView } from "@/components/not-found-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { listProjectInstances } from "@/lib/api";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";

const SECTIONS = [
  { key: "databases", label: "Databases", icon: Table2 },
  { key: "users", label: "Users", icon: UserRound },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

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
  const [section, setSection] = useState<SectionKey>("databases");

  const {
    data: instances,
    isLoading,
    mutate,
  } = useSWR(
    ["project-instances", projectId],
    async () => {
      const response = await listProjectInstances({
        path: { project_id: projectId },
      });
      if (response.error) {
        throw new Error(
          response.error.error?.msg ?? "Failed to load instances",
        );
      }
      return response.data ?? [];
    },
    { refreshInterval: 10000 },
  );

  const canManage = hasServerPermission(
    permissions,
    ServerPermission.DATABASE_MANAGE,
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const instance = instances?.find((candidate) => candidate.id === instanceId);
  if (!instance) return <NotFoundView />;

  const running = instance.state === "running";

  return (
    <div className="flex flex-col gap-6">
      <InstanceManagementBar
        projectId={projectId}
        instance={instance}
        canManage={canManage}
        onChanged={() => void mutate()}
      />

      {!running && !instance.suspended ? (
        <Alert>
          <AlertTitle>The instance is not running</AlertTitle>
          <AlertDescription>
            Start it before creating databases or users — the engine has to be
            up for those to take effect.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((entry) => (
          <Button
            key={entry.key}
            type="button"
            variant={entry.key === section ? "default" : "outline"}
            size="sm"
            onClick={() => setSection(entry.key)}
            className="inline-flex items-center gap-2"
          >
            <entry.icon className="size-4" />
            {entry.label}
          </Button>
        ))}
      </div>

      <Separator />

      {section === "databases" ? (
        <InstanceDatabases
          projectId={projectId}
          instanceId={instanceId}
          canManage={canManage}
        />
      ) : (
        <InstanceUsers
          projectId={projectId}
          instanceId={instanceId}
          canManage={canManage}
        />
      )}
    </div>
  );
}
