import { NotFoundView } from "@/components/not-found-view";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  hasManagementPermission,
} from "@/lib/permissions";
import { AdminDomainsView } from "./domains-view";

export default function AdminDomainsPage() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;

  if (
    !session ||
    !hasManagementPermission(
      session.user.permissions,
      ManagementPermission.DOMAINS_VIEW,
    )
  ) {
    return <NotFoundView />;
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <AdminDomainsView />
    </div>
  );
}
