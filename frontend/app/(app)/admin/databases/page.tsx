
import { NotFoundView } from "@/components/not-found-view";
import { useDatabaseHosts, useGroupNames } from "@/hooks/use-shared-queries";
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

  const { data: hosts, mutate } = useDatabaseHosts(canView);

  const { data: groups } = useGroupNames(canView);

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <DatabaseHostsTable
        hosts={hosts ?? []}
        groups={groups ?? []}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
