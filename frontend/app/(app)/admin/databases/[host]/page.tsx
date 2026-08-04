import { useParams } from "react-router-dom";
import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listDatabaseHosts, listDatabaseInstances } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { DatabaseInstancesTable } from "./database-instances-table";

export default function AdminDatabaseHostPage() {
  const { host: hostId } = useParams<{ host: string }>();
  const { data: session, isLoading } = authClient.useSession();

  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.DATABASE_HOSTS_VIEW,
      )
    : false;
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.DATABASE_HOSTS_MANAGE,
      )
    : false;

  const { data: hosts } = useSWR(
    canView ? "admin/database-hosts" : null,
    async () => {
      const response = await listDatabaseHosts();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const { data: instances, mutate } = useSWR(
    canView && hostId ? ["admin/database-instances", hostId] : null,
    async () => {
      const response = await listDatabaseInstances({
        path: { host_id: hostId as string },
      });
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!canView || !hostId) return <NotFoundView />;

  const host = hosts?.find((candidate) => candidate.id === hostId);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <DatabaseInstancesTable
        hostId={hostId}
        hostName={host?.display ?? hostId}
        instances={instances ?? []}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
