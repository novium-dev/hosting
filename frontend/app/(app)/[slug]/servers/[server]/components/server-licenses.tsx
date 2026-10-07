"use client";

import { useState } from "react";
import useSWR from "swr";
import { CheckCircle2, ExternalLink, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { acceptServerLicense, serverLicenses } from "@/lib/api";

type ServerLicense = {
  id: string;
  display: string;
  description: string;
  url: string;
  accepted: boolean;
  accepted_at?: number | null;
  accepted_by?: string | null;
};

function useServerLicenses(serverId: string) {
  const { data, isLoading, mutate } = useSWR(
    serverId ? ["server-licenses", serverId] : null,
    () => serverLicenses({ path: { server_id: serverId } }),
  );

  const licenses: ServerLicense[] =
    data && !data.error ? (data.data ?? []) : [];

  return { licenses, isLoading, mutate };
}

function LicenseLink({ license }: Readonly<{ license: ServerLicense }>) {
  const { t } = useTranslation();

  return (
    <Button
      variant="outline"
      size="sm"
      render={<a href={license.url} target="_blank" rel="noreferrer" />}
      nativeButton={false}
    >
      <ExternalLink className="size-4" />
      {t("servers:licenses.readLicense")}
    </Button>
  );
}

export function ServerLicenseNotice({
  serverId,
  canAccept,
}: Readonly<{ serverId: string; canAccept: boolean }>) {
  const { t } = useTranslation();
  const { licenses, mutate } = useServerLicenses(serverId);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const pending = licenses.filter((license) => !license.accepted);

  if (pending.length === 0) {
    return null;
  }

  const accept = async (license: ServerLicense) => {
    setPendingId(license.id);

    try {
      const response = await acceptServerLicense({
        path: { server_id: serverId, license_id: license.id },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? t("servers:licenses.toasts.failed"),
        );
        return;
      }

      toast.success(
        t("servers:licenses.toasts.accepted", { license: license.display }),
      );
      await mutate();
    } catch {
      toast.error(t("servers:licenses.toasts.failed"));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {pending.map((license) => (
        <Card key={license.id} className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-5 text-amber-600 dark:text-amber-400" />
              {t("servers:licenses.noticeTitle", { license: license.display })}
            </CardTitle>
            <CardDescription>{license.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t("servers:licenses.noticeHint")}
            </p>

            {canAccept ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`license-${license.id}`}
                    checked={confirmed[license.id] ?? false}
                    onCheckedChange={(checked) =>
                      setConfirmed((previous) => ({
                        ...previous,
                        [license.id]: checked === true,
                      }))
                    }
                  />
                  <Label
                    htmlFor={`license-${license.id}`}
                    className="text-sm font-normal"
                  >
                    {t("servers:licenses.confirmLabel", {
                      license: license.display,
                    })}
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <LicenseLink license={license} />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      !(confirmed[license.id] ?? false) ||
                      pendingId === license.id
                    }
                    loading={pendingId === license.id}
                    onClick={() => void accept(license)}
                  >
                    {t("servers:licenses.accept")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("servers:licenses.noPermission")}
                </p>
                <LicenseLink license={license} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ServerLicenseList({
  serverId,
}: Readonly<{ serverId: string }>) {
  const { t, i18n } = useTranslation();
  const { licenses } = useServerLicenses(serverId);

  if (licenses.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("servers:licenses.title")}</CardTitle>
        <CardDescription>{t("servers:licenses.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {licenses.map((license) => (
          <div
            key={license.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{license.display}</p>
              <p className="text-xs text-muted-foreground">
                {license.accepted
                  ? license.accepted_at
                    ? t("servers:licenses.acceptedBy", {
                        user: license.accepted_by ?? t("common:status.unknown"),
                        date: new Date(
                          license.accepted_at * 1000,
                        ).toLocaleDateString(i18n.language),
                      })
                    : t("servers:licenses.acceptedState")
                  : t("servers:licenses.pendingState")}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {license.accepted ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : null}
              <LicenseLink license={license} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
