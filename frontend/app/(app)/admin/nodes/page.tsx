import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listNodes } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";
import { NodesTable } from "./nodes-table";

export default function AdminNodesPage() {
  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_VIEW,
      )
    : false;

  const { data: nodes, mutate } = useSWR(
    canView ? "admin/nodes" : null,
    async () => {
      const response = await listNodes();
      return response.error ? [] : (response.data ?? []);
    },
  );

  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_MANAGE,
      )
    : false;

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <NodesTable
        nodes={nodes ?? []}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
