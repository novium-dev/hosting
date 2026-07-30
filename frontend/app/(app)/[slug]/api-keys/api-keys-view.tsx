"use client";

import useSWR from "swr";

import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { listProjectApiKeys } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";

interface ApiKeysViewProps {
  projectId: string;
  /** The viewer's permissions in this project. */
  permissions: number;
}

export function ApiKeysView({ projectId, permissions }: ApiKeysViewProps) {
  const { data: session } = authClient.useSession();
  const {
    data: keys,
    error,
    isLoading,
    mutate,
  } = useSWR(["project-api-keys", projectId], async () => {
    const response = await listProjectApiKeys({
      path: { project_id: projectId },
    });
    if (response.error) {
      throw new Error(response.error.error?.msg ?? "Failed to load API keys");
    }
    return response.data ?? [];
  });

  // Project admins see (and can revoke) everyone's keys here; everyone else
  // only ever gets their own back from the API.
  const isProjectAdmin = hasServerPermission(
    permissions,
    ServerPermission.ADMIN_MANAGEMENT,
  );
  const owns = (userId: number) => String(userId) === session?.user.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Keys act as their owner inside this project, limited to the
            permissions they were given.
          </p>
        </div>
        <CreateApiKeyDialog
          projectId={projectId}
          onCreated={() => void mutate()}
        />
      </div>
      <ApiKeysTable
        keys={keys}
        isLoading={isLoading}
        error={Boolean(error)}
        showOwner={isProjectAdmin}
        canEdit={(apiKey) => owns(apiKey.user)}
        canDelete={(apiKey) => owns(apiKey.user) || isProjectAdmin}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
