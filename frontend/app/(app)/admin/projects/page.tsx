import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listProjects } from "@/lib/api";
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

  const { data: projects } = useSWR(
    canView ? "admin/projects" : null,
    async () => {
      const response = await listProjects();
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ProjectsTable projects={projects ?? []} />
    </div>
  );
}
