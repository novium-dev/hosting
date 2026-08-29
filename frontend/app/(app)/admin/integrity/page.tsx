import { NotFoundView } from "@/components/not-found-view";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { IntegrityView } from "./integrity-view";

export default function AdminIntegrityPage() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;

  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.INTEGRITY_VIEW,
      )
    : false;

  if (!canView) return <NotFoundView />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <IntegrityView />
    </div>
  );
}
