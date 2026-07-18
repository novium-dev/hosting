import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { listServers } from "@/lib/api";
import { auth } from "@/lib/auth";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { ServersTable } from "./servers-table";

export const metadata: Metadata = {
  title: "Servers | Hephaestus Admin",
  description: "Manage servers in Hephaestus Admin",
};

export default async function AdminServersPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (
    !session ||
    !hasManagementPermission(
      session.user.permissions,
      ManagementPermission.SERVER_MANAGE,
    )
  ) {
    notFound();
  }

  const response = await listServers({
    headers: requestHeaders,
  });

  const servers = response.error ? [] : (response.data ?? []);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ServersTable servers={servers} />
    </div>
  );
}
