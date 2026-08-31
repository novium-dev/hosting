import useSWR from "swr";
import { listServers } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { ServersTable } from "./servers-table";

export default function AdminServersPage() {
  const { data: session, isLoading } = authClient.useSession();

  const { data: servers } = useSWR(
    session ? "admin/servers" : null,
    async () => {
      const response = await listServers();
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ServersTable servers={servers ?? []} />
    </div>
  );
}
