import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listRegions } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { RegionsTable } from "./regions-table";

export default function AdminRegionsPage() {
  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_VIEW,
      )
    : false;
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_MANAGE,
      )
    : false;

  const { data: regions, mutate } = useSWR(
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
      <RegionsTable
        regions={regions ?? []}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
