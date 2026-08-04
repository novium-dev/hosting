"use client";

import useSWR from "swr";

import { CreateDatabaseDialog } from "@/components/databases/create-database-dialog";
import { DatabasesTable } from "@/components/databases/databases-table";
import { listProjectDatabases } from "@/lib/api";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";

/** Mirrors MAX_PROJECT_DATABASES in the backend. */
const DATABASE_LIMIT = 4;

interface DatabasesViewProps {
  projectId: string;
  /** The viewer's permissions in this project. */
  permissions: number;
}

export function DatabasesView({ projectId, permissions }: DatabasesViewProps) {
  const {
    data: databases,
    error,
    isLoading,
    mutate,
  } = useSWR(["project-databases", projectId], async () => {
    const response = await listProjectDatabases({
      path: { project_id: projectId },
    });
    if (response.error) {
      throw new Error(response.error.error?.msg ?? "Failed to load databases");
    }
    return response.data ?? [];
  });

  const canManage = hasServerPermission(
    permissions,
    ServerPermission.DATABASE_MANAGE,
  );
  const atLimit = (databases?.length ?? 0) >= DATABASE_LIMIT;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-semibold">Databases</h1>
          <p className="text-sm text-muted-foreground">
            Each database is reachable from anywhere with the credentials below.
            A project can hold up to {DATABASE_LIMIT}.
          </p>
        </div>
        {canManage ? (
          <CreateDatabaseDialog
            projectId={projectId}
            atLimit={atLimit}
            onCreated={() => void mutate()}
          />
        ) : null}
      </div>
      <DatabasesTable
        projectId={projectId}
        databases={databases}
        isLoading={isLoading}
        error={Boolean(error)}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
