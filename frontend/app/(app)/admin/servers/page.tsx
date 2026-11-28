import { authClient } from "@/lib/auth-client";
import { ServersTable } from "./servers-table";

export default function AdminServersPage() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading || !session) return null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ServersTable />
    </div>
  );
}
