import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listProjectFeatures, listProjects } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { ProjectsTable } from "./projects-table";

export default function AdminProjectsPage() {
  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.SERVER_MANAGE,
      )
    : false;

  const canManageFeatures = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.FEATURES_MANAGE,
      )
    : false;

  const { data: projects, mutate } = useSWR(
    canView ? "admin/projects" : null,
    async () => {
      const response = await listProjects();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const { data: features } = useSWR(
    canManageFeatures ? "admin/project-features" : null,
    async () => {
      const response = await listProjectFeatures();
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ProjectsTable
        projects={projects ?? []}
        features={features ?? []}
        canManageFeatures={canManageFeatures}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
