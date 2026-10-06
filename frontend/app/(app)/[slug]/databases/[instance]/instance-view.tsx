"use client";

import { useTranslation } from "react-i18next";

import { InstanceDatabases } from "@/components/databases/instance-databases";
import { InstanceDeleteCard } from "@/components/databases/instance-delete-card";
import { InstanceManagementBar } from "@/components/databases/instance-management-bar";
import { InstanceUsers } from "@/components/databases/instance-users";
import { NotFoundView } from "@/components/not-found-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectInstances } from "@/hooks/use-shared-queries";
import { getActiveInstanceSection } from "@/lib/instance-sections";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";

export function InstanceView({
  projectId,
  slug,
  instanceId,
  section,
  permissions,
}: {
  projectId: string;
  slug: string;
  instanceId: string;
  section: string;
  permissions: number;
}) {
  const { t } = useTranslation();
  const activeSection = getActiveInstanceSection(section);

  const {
    data: instances,
    isLoading,
    mutate,
  } = useProjectInstances(projectId, { refreshInterval: 10000 });

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
          <AlertTitle>{t("project:databases.instanceView.notRunningTitle")}</AlertTitle>
          <AlertDescription>
            {t("project:databases.instanceView.notRunningDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      {activeSection === "databases" ? (
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

      {canManage ? (
        <InstanceDeleteCard
          projectId={projectId}
          slug={slug}
          instance={instance}
        />
      ) : null}
    </div>
  );
}
