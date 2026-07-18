import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { listNodes, listTemplates } from "@/lib/api";
import { ServerCreateForm } from "@/app/(app)/admin/servers/create/server-create-form";
import { getAllOrganizationsAction } from "@/actions/organizations";
import { auth } from "@/lib/auth";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Create Server | Hephaestus Admin",
  description: "Create a new server from a template",
};

export default async function CreateServerPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (
    !session ||
    !hasManagementPermission(session.user.permissions, ManagementPermission.SERVER_MANAGE)
  ) {
    notFound();
  }

  const [organizations, templatesResponse, nodesResponse] = await Promise.all([
    getAllOrganizationsAction(),
    listTemplates({ headers: requestHeaders }),
    listNodes({ headers: requestHeaders }),
  ]);

  const templates = templatesResponse.error
    ? []
    : (templatesResponse.data ?? []);
  const nodes = nodesResponse.error ? [] : (nodesResponse.data ?? []);

  const safeOrganizations = organizations.data?.success
    ? organizations.data.data
    : [];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ServerCreateForm
        organizations={safeOrganizations}
        templates={templates}
        nodes={nodes.map((node) => ({
          id: node.id,
          display: node.display,
          serverStorages: node.server_storages,
          portAllocations: node.ports,
        }))}
      />
    </div>
  );
}
