"use client";

import { apiErrorMessage } from "@/lib/api-error";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { listAllApiKeys } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  hasManagementPermission,
} from "@/lib/permissions";

export function AdminApiKeysView() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const {
    data: keys,
    error,
    isLoading,
    mutate,
  } = useSWR("admin-api-keys", async () => {
    const response = await listAllApiKeys();
    if (response.error) {
      throw new Error(
        apiErrorMessage(response.error, t("admin-core:apiKeys.loadFailed")),
      );
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
          <h1 className="text-xl font-semibold">{t("common:nav.apiKeys")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-core:apiKeys.description")}
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
