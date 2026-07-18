import { NotFoundView } from "@/components/not-found-view";
import { authClient } from "@/lib/auth-client";
import { hasManagementPermission, ManagementPermission } from "@/lib/permissions";
import { UsersTable } from "./users-table";

export default function UsersPage() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;

  if (
    !session ||
    !hasManagementPermission(
      session.user.permissions,
      ManagementPermission.USER_VIEW,
    )
  ) {
    return <NotFoundView />;
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <UsersTable />
    </div>
  );
}
