import { authClient } from "@/lib/auth-client";
import { AdminOverview } from "./overview";

export default function AdminOverviewPage() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading || !session) return null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <AdminOverview permissions={session.user.permissions} />
    </div>
  );
}
