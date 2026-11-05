"use client";

import { useState } from "react";
import { Globe, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { DnsRecordsTable } from "@/components/routes/dns-records-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteProjectDomain,
  verifyProjectDomain,
  type ListProjectDomainsResponse,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

type Domain = ListProjectDomainsResponse[number];

interface DomainCardProps {
  projectId: string;
  domain: Domain;
  canManage: boolean;
  onChanged: () => void;
}

function CertificateBadge({ domain }: { domain: Domain }) {
  const { t, i18n } = useTranslation();
  const certificate = domain.certificate;

  if (!domain.verified) return null;

  if (certificate?.expires_at) {
    return (
      <Badge variant="default">
        {t("project:domains.certificate.validUntil", {
          date: new Date(certificate.expires_at).toLocaleDateString(
            i18n.language,
          ),
        })}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      {t("project:domains.certificate.pending")}
    </Badge>
  );
}

export function DomainCard({
  projectId,
  domain,
  canManage,
  onChanged,
}: DomainCardProps) {
  const { t } = useTranslation();
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const verify = async () => {
    setIsVerifying(true);

    try {
      const response = await verifyProjectDomain({
        path: { project_id: projectId, domain_id: domain.id },
      });

      if (response.error || !response.data) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("project:domains.toasts.verifyFailed"),
          ),
        );
      }

      toast.success(
        t("project:domains.toasts.verified", { domain: domain.domain }),
      );
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("project:domains.toasts.verifyFailed"),
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const remove = async () => {
    setIsDeleting(true);

    try {
      const response = await deleteProjectDomain({
        path: { project_id: projectId, domain_id: domain.id },
      });

      if (response.error) {
        throw new Error(
          apiErrorMessage(
            response.error,
            t("project:domains.toasts.deleteFailed"),
          ),
        );
      }

      toast.success(
        t("project:domains.toasts.deleted", { domain: domain.domain }),
      );
      setConfirmDelete(false);
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("project:domains.toasts.deleteFailed"),
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const certificateError = domain.verified ? domain.certificate?.error : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Globe className="size-4 text-muted-foreground" />
              <span className="break-all">{domain.domain}</span>
              <Badge variant={domain.verified ? "default" : "secondary"}>
                {domain.verified
                  ? t("project:domains.status.verified")
                  : t("project:domains.status.pending")}
              </Badge>
              <CertificateBadge domain={domain} />
            </CardTitle>
            <CardDescription>
              {domain.verified
                ? t("project:domains.recordsVerified")
                : t("project:domains.recordsPending")}
            </CardDescription>
          </div>
          {canManage ? (
            <div className="flex shrink-0 gap-2">
              {domain.verified ? null : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isVerifying}
                  onClick={() => void verify()}
                >
                  {isVerifying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {t("project:domains.verifyButton")}
                </Button>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("common:actions.delete")}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {domain.records.length > 0 ? (
          <DnsRecordsTable records={domain.records} />
        ) : null}
        {certificateError ? (
          <p className="text-xs text-destructive">
            {t("project:domains.certificate.error", {
              error: certificateError,
            })}
          </p>
        ) : null}
        {domain.verified ? null : (
          <p className="text-xs text-muted-foreground">
            {t("project:domains.pendingHelp")}
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:confirmDelete.title", { name: domain.domain })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:domains.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={() => void remove()}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
