"use client";

import { apiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { ApiKeysTable } from "@/components/api-keys/api-keys-table";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { TablePagination } from "@/components/table-pagination";
import { PAGE_SIZE, toPage } from "@/hooks/use-paged-table";
import { listAllApiKeys } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  hasManagementPermission,
  removePermissions,
} from "@/lib/permissions";

export function AdminApiKeysView() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const [page, setPage] = useState(0);
  const { data, error, isLoading, mutate } = useSWR(
    ["admin-api-keys/page", page],
    async ([, page]) => {
      const response = await listAllApiKeys({
        query: { page, limit: PAGE_SIZE },
      });
      if (response.error) {
        throw new Error(
          apiErrorMessage(response.error, t("admin-core:apiKeys.loadFailed")),
        );
      }
      return toPage(response);
    },
    { keepPreviousData: true },
  );

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
        keys={data?.items}
        isLoading={isLoading}
        error={Boolean(error)}
        showScope
        showOwner
        admin={canManage}
        canEdit={(apiKey) =>
          String(apiKey.user) === session?.user.id ||
          (canManage &&
            removePermissions(
              apiKey.permissions,
              session?.user.permissions ?? 0,
            ) === 0)
        }
        canDelete={() => canManage}
        onChanged={() =>
          void mutate().then((next) => {
            if (next && next.items.length === 0 && page > 0) {
              setPage(page - 1);
            }
          })
        }
      />
      <TablePagination
        page={page}
        total={data?.total ?? 0}
        totalPages={data?.totalPages ?? 1}
        onPageChange={setPage}
      />
    </div>
  );
}
