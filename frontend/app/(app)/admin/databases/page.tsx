import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listDatabaseHosts, listRegions } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { DatabaseHostsTable } from "./database-hosts-table";

export default function AdminDatabasesPage() {
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

  const { data: hosts, mutate } = useSWR(
    canView ? "admin/database-hosts" : null,
    async () => {
      const response = await listDatabaseHosts();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const { data: regions } = useSWR(
    canView ? "admin/regions" : null,
    async () => {
      const response = await listRegions();
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <DatabaseHostsTable
        hosts={hosts ?? []}
        regions={regions ?? []}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
