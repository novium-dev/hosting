import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { useGroups } from "@/hooks/use-shared-queries";
import { listNodes } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { GroupsTable } from "./groups-table";

export default function AdminGroupsPage() {
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

  const { data: groups, mutate } = useGroups(canView);
  const { data: nodeNames } = useSWR(
    canView ? "admin/groups/node-names" : null,
    async () => {
      const response = await listNodes();
      return Object.fromEntries(
        (response.data ?? []).map((node) => [node.id, node.display]),
      );
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <GroupsTable
        groups={groups ?? []}
        nodeNames={nodeNames ?? {}}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
