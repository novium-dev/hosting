import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";
import { UsersTable } from "./users-table";

export const metadata: Metadata = {
  title: "Users | Hephaestus Admin",
  description: "Manage users in Hephaestus Admin",
};

export default async function UsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (
    !session ||
    !hasManagementPermission(session.user.permissions, ManagementPermission.USER_VIEW)
  ) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <UsersTable />
    </div>
  );
}
