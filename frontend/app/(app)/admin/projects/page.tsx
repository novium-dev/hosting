import useSWR from "swr";

import { listProjectFeatures, listProjects } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { ProjectsTable } from "./projects-table";

export default function AdminProjectsPage() {
  const { data: session, isLoading } = authClient.useSession();

  const canManageFeatures = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.FEATURES_MANAGE,
      )
    : false;

  const { data: projects, mutate } = useSWR(
    session ? "admin/projects" : null,
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
