import useSWR from "swr";

import { NotFoundView } from "@/components/not-found-view";
import { listGroups, listNodes } from "@/lib/api";
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

  const { data, mutate } = useSWR(canView ? "admin/groups" : null, async () => {
    const [groupsResponse, nodesResponse] = await Promise.all([
      listGroups(),
      listNodes(),
    ]);
    return {
      groups: groupsResponse.error ? [] : (groupsResponse.data ?? []),
      nodeNames: Object.fromEntries(
        (nodesResponse.data ?? []).map((node) => [node.id, node.display]),
      ),
    };
  });

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <GroupsTable
        groups={data?.groups ?? []}
        nodeNames={data?.nodeNames ?? {}}
        canManage={canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
