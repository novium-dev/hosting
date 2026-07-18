import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { AdminNavbar } from "@/components/navigation/admin-navbar";
import { hasAnyManagementPermission } from "@/lib/permissions";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !hasAnyManagementPermission(session.user.permissions)) {
    return notFound();
  }

  return (
    <div className="min-h-svh bg-background">
      <AdminNavbar permissions={session.user.permissions} />
      <main className="mx-auto w-full max-w-400">{children}</main>
    </div>
  );
}
