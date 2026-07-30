"use client";

import useSWR from "swr";

import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { listAllApiKeys } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  hasManagementPermission,
} from "@/lib/permissions";

export function AdminApiKeysView() {
  const { data: session } = authClient.useSession();
  const {
    data: keys,
    error,
    isLoading,
    mutate,
  } = useSWR("admin-api-keys", async () => {
    const response = await listAllApiKeys();
    if (response.error) {
      throw new Error(response.error.error?.msg ?? "Failed to load API keys");
    }
    return response.data ?? [];
  });

  const canManage = hasManagementPermission(
    session?.user.permissions ?? 0,
    ManagementPermission.API_KEYS_MANAGE,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold">API keys</h1>
          <p className="text-sm text-muted-foreground">
            Every key on this instance. A key can only ever do what its owner
            can, and instance-wide keys carry management permissions.
          </p>
        </div>
        {canManage ? (
          <CreateApiKeyDialog onCreated={() => void mutate()} />
        ) : null}
      </div>
      <ApiKeysTable
        keys={keys}
        isLoading={isLoading}
        error={Boolean(error)}
        showScope
        showOwner
        admin={canManage}
        canEdit={(apiKey) => String(apiKey.user) === session?.user.id}
        canDelete={() => canManage}
        onChanged={() => void mutate()}
      />
    </div>
  );
}
