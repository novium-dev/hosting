"use client";

import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { CreateInstanceDialog } from "@/components/databases/create-instance-dialog";
import { InstancesTable } from "@/components/databases/instances-table";
import { listProjectInstances } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  ServerPermission,
  hasManagementPermission,
  hasServerPermission,
} from "@/lib/permissions";

/** Mirrors MAX_PROJECT_INSTANCES in the backend. */
const INSTANCE_LIMIT = 4;

interface DatabasesViewProps {
  projectId: string;
  slug: string;
  /** The viewer's permissions in this project. */
  permissions: number;
}

export function DatabasesView({
  projectId,
  slug,
  permissions,
}: DatabasesViewProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const {
    data: instances,
    error,
    isLoading,
    mutate,
  } = useSWR(["project-instances", projectId], async () => {
    const response = await listProjectInstances({
      path: { project_id: projectId },
    });
    if (response.error) {
      throw new Error(response.error.error?.msg ?? "Failed to load instances");
    }
    return response.data ?? [];
  });

  const canManage = hasServerPermission(
    permissions,
    ServerPermission.DATABASE_MANAGE,
  );
  const bypassesLimit = hasManagementPermission(
    session?.user.permissions ?? 0,
    ManagementPermission.LIMITS_BYPASS,
  );
  const atLimit =
    !bypassesLimit && (instances?.length ?? 0) >= INSTANCE_LIMIT;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.databases")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("org:databases.description")}{" "}
            {bypassesLimit
              ? t("org:databases.descriptionBypass")
              : t("org:databases.descriptionLimit", { limit: INSTANCE_LIMIT })}
          </p>
        </div>
        {canManage ? (
          <CreateInstanceDialog
            projectId={projectId}
            atLimit={atLimit}
            onCreated={() => void mutate()}
          />
        ) : null}
      </div>
      <InstancesTable
        projectId={projectId}
        slug={slug}
        instances={instances}
        isLoading={isLoading}
        error={Boolean(error)}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
