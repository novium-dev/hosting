"use client";

import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { listProjectDomains } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { authClient } from "@/lib/auth-client";
import {
  ManagementPermission,
  ServerPermission,
  hasManagementPermission,
  hasServerPermission,
} from "@/lib/permissions";
import { AddDomainDialog } from "./add-domain-dialog";
import { DomainCard } from "./domain-card";

/** Mirrors MAX_PROJECT_DOMAINS in the backend. */
const DOMAIN_LIMIT = 10;

interface DomainsViewProps {
  projectId: string;
  /** The viewer's permissions in this project. */
  permissions: number;
}

export function DomainsView({ projectId, permissions }: DomainsViewProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const {
    data: domains,
    error,
    isLoading,
    mutate,
  } = useSWR(["project-domains", projectId], async ([, id]) => {
    const response = await listProjectDomains({
      path: { project_id: id },
    });
    if (response.error) {
      throw new Error(
        apiErrorMessage(response.error, t("project:domains.toasts.loadFailed")),
      );
    }
    return response.data ?? [];
  });

  const canManage = hasServerPermission(
    permissions,
    ServerPermission.DOMAINS_MANAGE,
  );
  const bypassesLimit = hasManagementPermission(
    session?.user.permissions ?? 0,
    ManagementPermission.LIMITS_BYPASS,
  );
  const atLimit = !bypassesLimit && (domains?.length ?? 0) >= DOMAIN_LIMIT;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.domains")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("project:domains.description")}
          </p>
        </div>
        {canManage ? (
          <AddDomainDialog
            projectId={projectId}
            atLimit={atLimit}
            onCreated={() => void mutate()}
          />
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : t("project:domains.toasts.loadFailed")}
          </CardContent>
        </Card>
      ) : !domains || domains.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("project:domains.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              projectId={projectId}
              domain={domain}
              canManage={canManage}
              onChanged={() => void mutate()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
