import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { listNodes } from "@/lib/api";
import { auth } from "@/lib/auth";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";
import { NodesTable } from "./nodes-table";

export const metadata: Metadata = {
  title: "Nodes | Hephaestus Admin",
  description: "Manage nodes in Hephaestus Admin",
};

export default async function AdminNodesPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (
    !session ||
    !hasManagementPermission(session.user.permissions, ManagementPermission.NODES_VIEW)
  ) {
    notFound();
  }

  const response = await listNodes({
    headers: requestHeaders,
  });

  const nodes = response.error ? [] : (response.data ?? []);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <NodesTable nodes={nodes} />
    </div>
  );
}
