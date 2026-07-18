import { Outlet } from "react-router-dom";
import { AdminNavbar } from "@/components/navigation/admin-navbar";
import { authClient } from "@/lib/auth-client";
import { hasAnyManagementPermission } from "@/lib/permissions";

export default function AdminLayout() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;

  if (!session || !hasAnyManagementPermission(session.user.permissions)) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Not found</h1>
        <p className="text-sm text-muted-foreground">
          This page doesn&apos;t exist or you don&apos;t have access to it.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <AdminNavbar permissions={session.user.permissions} />
      <main className="mx-auto w-full max-w-400">
        <Outlet />
      </main>
    </div>
  );
}
