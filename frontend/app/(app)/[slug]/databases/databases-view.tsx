"use client";

import { useTranslation } from "react-i18next";

import { CreateDatabaseDialog } from "@/components/databases/create-database-dialog";
import { hasNamedDatabases } from "@/components/databases/database-type";
import { ProjectDatabasesTable } from "@/components/databases/project-databases-table";
import { useProjectDatabases } from "@/hooks/use-shared-queries";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";

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
  const {
    data: databases,
    error,
    isLoading,
    mutate,
  } = useProjectDatabases(projectId);

  const canManage = hasServerPermission(
    permissions,
    ServerPermission.DATABASE_MANAGE,
  );
  const unavailableTypes = (databases ?? [])
    .map((database) => database.type)
    .filter((type) => !hasNamedDatabases(type));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.databases")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("project:databases.description")}
          </p>
        </div>
        {canManage ? (
          <CreateDatabaseDialog
            projectId={projectId}
            unavailableTypes={unavailableTypes}
            onCreated={() => void mutate()}
          />
        ) : null}
      </div>
      <ProjectDatabasesTable
        projectId={projectId}
        slug={slug}
        databases={databases}
        canManage={canManage}
        isLoading={isLoading}
        error={Boolean(error)}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
