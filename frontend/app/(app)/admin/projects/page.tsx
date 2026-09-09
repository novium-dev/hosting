import useSWR from "swr";

import { listProjects, listUsers } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { ProjectsTable } from "./projects-table";

export default function AdminProjectsPage() {
  const { data: session, isLoading } = authClient.useSession();

  const canManageUsers = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.USER_MANAGE,
      )
    : false;

  const { data: projects, mutate } = useSWR(
    session ? "admin/projects" : null,
    async () => {
      const response = await listProjects();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const { data: owners } = useSWR(
    canManageUsers ? "admin/project-owners" : null,
    async () => {
      const response = await listUsers();
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ProjectsTable
        projects={projects ?? []}
        owners={canManageUsers ? (owners ?? []) : null}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
