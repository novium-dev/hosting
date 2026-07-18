import useSWR from "swr";
import { NotFoundView } from "@/components/not-found-view";
import { listServers } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { ServersTable } from "./servers-table";

export default function AdminServersPage() {
  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.SERVER_MANAGE,
      )
    : false;

  const { data: servers } = useSWR(
    canView ? "admin/servers" : null,
    async () => {
      const response = await listServers();
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ServersTable servers={servers ?? []} />
    </div>
  );
}
