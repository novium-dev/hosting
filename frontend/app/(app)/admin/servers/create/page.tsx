import useSWR from "swr";
import { NotFoundView } from "@/components/not-found-view";
import { listNodes, listTemplates } from "@/lib/api";
import { ServerCreateForm } from "@/app/(app)/admin/servers/create/server-create-form";
import { getAllOrganizationsAction } from "@/actions/organizations";
import { authClient } from "@/lib/auth-client";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";

export default function CreateServerPage() {
  const { data: session, isLoading } = authClient.useSession();
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.SERVER_MANAGE,
      )
    : false;

  const { data } = useSWR(canManage ? "admin/create-server" : null, async () => {
    const [organizations, templatesResponse, nodesResponse] = await Promise.all(
      [getAllOrganizationsAction(), listTemplates(), listNodes()],
    );

    return {
      organizations: organizations.data?.success
        ? organizations.data.data
        : [],
      templates: templatesResponse.error ? [] : (templatesResponse.data ?? []),
      nodes: nodesResponse.error ? [] : (nodesResponse.data ?? []),
    };
  });

  if (isLoading) return null;
  if (!canManage) return <NotFoundView />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ServerCreateForm
        organizations={data.organizations}
        templates={data.templates}
        nodes={data.nodes.map((node) => ({
          id: node.id,
          display: node.display,
          serverStorages: node.server_storages,
          portAllocations: node.ports,
        }))}
      />
    </div>
  );
}
