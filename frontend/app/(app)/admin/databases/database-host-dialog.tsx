"use client";

import { apiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createDatabaseHost,
  updateDatabaseHost,
  updateDatabaseHostRegistration,
  type DatabaseType,
} from "@/lib/api";
import { DATABASE_TYPE_LABELS } from "@/components/databases/database-type";
import type {
  DatabaseHostRegistrationRow,
  DatabaseHostRow,
} from "./database-hosts-table";
import type { GroupRef } from "@/lib/api";

const ENGINES = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

/** Falls back to the agent's own defaults when a port is left blank. */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  postgres: 5432,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
};

type DatabaseHostFormProps = {
  onOpenChange: (open: boolean) => void;
  host?: DatabaseHostRow;
  registration?: DatabaseHostRegistrationRow;
  groups: GroupRef[];
  onSaved: () => void;
};

export function DatabaseHostDialog({
  open,
  ...props
}: DatabaseHostFormProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DatabaseHostForm
          key={props.host?.id ?? props.registration?.code ?? "new"}
          {...props}
        />
      </DialogContent>
    </Dialog>
  );
}

function DatabaseHostForm({
  onOpenChange,
  host,
  registration,
  groups,
  onSaved,
}: DatabaseHostFormProps) {
  const { t } = useTranslation();
  const [display, setDisplay] = useState(
    host?.display ?? registration?.display ?? "",
  );
  const [selectedGroups, setSelectedGroups] = useState<number[]>(() =>
    (host?.groups ?? registration?.groups ?? []).map((group) => group.id),
  );
  const [url, setUrl] = useState(host?.url ?? registration?.base_url ?? "");
  const [publicHost, setPublicHost] = useState(
    host?.public_host ?? registration?.public_host ?? "",
  );
  const [maintenance, setMaintenance] = useState(host?.maintenance ?? false);
  const [ports, setPorts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ENGINES.map((engine) => {
        const port = host?.ports?.[engine] ?? registration?.ports?.[engine];
        return [engine, port ? String(port) : ""];
      }),
    ),
  );
  const [isPending, setIsPending] = useState(false);
  const [setupCode, setSetupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const collectPorts = () =>
    Object.fromEntries(
      ENGINES.flatMap((engine) => {
        const value = ports[engine]?.trim();
        if (!value) return [];
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
          ? [[engine, parsed] as const]
          : [];
      }),
    );

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success(t("admin-infra:databases.hostDialog.setupCodeCopied"));
  };

  const submit = async () => {
    setIsPending(true);
    try {
      if (host) {
        const response = await updateDatabaseHost({
          path: { host_id: host.id },
          body: {
            display,
            groups: selectedGroups,
            url,
            public_host: publicHost,
            maintenance,
            ports: collectPorts(),
          },
        });

        if (response.error) {
          toast.error(
            apiErrorMessage(
              response.error,
              t("admin-infra:databases.hostDialog.saveError"),
            ),
          );
          return;
        }

        toast.success(t("admin-infra:databases.hostDialog.updateSuccess"));
        onOpenChange(false);
        onSaved();
        return;
      }

      const body = {
        display,
        groups: selectedGroups,
        base_url: url,
        public_host: publicHost,
        ports: collectPorts(),
      };

      if (registration) {
        const response = await updateDatabaseHostRegistration({
          path: { code: registration.code },
          body,
        });

        if (response.error) {
          toast.error(
            apiErrorMessage(
              response.error,
              t("admin-infra:databases.hostDialog.saveError"),
            ),
          );
          return;
        }

        toast.success(t("admin-infra:databases.hostDialog.updateSuccess"));
        onOpenChange(false);
        onSaved();
        return;
      }

      const response = await createDatabaseHost({ body });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("admin-infra:databases.hostDialog.saveError"),
          ),
        );
        return;
      }

      setSetupCode(response.data ?? null);
      onSaved();
    } finally {
      setIsPending(false);
    }
  };

  const canSubmit =
    display.trim() !== "" && url.trim() !== "" && publicHost.trim() !== "";

  return (
    <>
      {setupCode ? (
        <>
          <DialogHeader>
            <DialogTitle>
              {t("admin-infra:databases.hostDialog.setupCodeTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin-infra:databases.hostDialog.setupCodeDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border bg-muted/40 p-3">
            <code className="block break-all font-mono text-sm">
              {setupCode}
            </code>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyCode(setupCode)}
            >
              {copied ? (
                <CheckIcon data-icon="inline-start" />
              ) : (
                <CopyIcon data-icon="inline-start" />
              )}
              {t("admin-infra:databases.hostDialog.copyCodeButton")}
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("admin-infra:shared.done")}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle>
              {host
                ? t("admin-infra:databases.hostDialog.editTitle")
                : registration
                  ? t("admin-infra:databases.hostDialog.editRegistrationTitle")
                  : t("admin-infra:databases.hostDialog.registerTitle")}
            </DialogTitle>
            <DialogDescription>
              {host
                ? t("admin-infra:databases.hostDialog.description")
                : t("admin-infra:databases.hostDialog.setupDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {registration ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {t("admin-infra:databases.hostDialog.setupCodeTitle")}
                  </p>
                  <code className="block break-all font-mono text-sm">
                    {registration.code}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyCode(registration.code)}
                >
                  {copied ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  {t("admin-infra:databases.hostDialog.copyCodeButton")}
                </Button>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="display">{t("common:labels.name")}</Label>
              <Input
                id="display"
                value={display}
                onChange={(event) => setDisplay(event.target.value)}
                placeholder="db-eu-1"
              />
            </div>

            <div className="space-y-2">
              <Label>{t("navigation:adminSidebar.items.groups")}</Label>
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("admin-infra:databases.hostDialog.noGroups")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border p-3">
                  {groups.map((group) => (
                    <label
                      key={group.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selectedGroups.includes(group.id)}
                        onCheckedChange={(checked) =>
                          setSelectedGroups((current) =>
                            checked === true
                              ? [...current, group.id]
                              : current.filter((entry) => entry !== group.id),
                          )
                        }
                      />
                      {group.label}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("admin-infra:databases.hostDialog.groupsDescription")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">
                {t("admin-infra:databases.hostDialog.urlLabel")}
              </Label>
              <Input
                id="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://db-eu-1.example.com:8090"
              />
              <p className="text-xs text-muted-foreground">
                {t("admin-infra:databases.hostDialog.urlDescription")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="public-host">
                {t("admin-infra:databases.hostDialog.publicHostLabel")}
              </Label>
              <Input
                id="public-host"
                value={publicHost}
                onChange={(event) => setPublicHost(event.target.value)}
                placeholder="db-eu-1.example.com"
              />
            </div>

            <div className="space-y-2">
              <Label>
                {t("admin-infra:databases.hostDialog.publicPortsLabel")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("admin-infra:databases.hostDialog.publicPortsDescription")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ENGINES.map((engine) => (
                  <div key={engine} className="space-y-1">
                    <Label
                      htmlFor={`port-${engine}`}
                      className="text-xs font-normal text-muted-foreground"
                    >
                      {DATABASE_TYPE_LABELS[engine]}
                    </Label>
                    <Input
                      id={`port-${engine}`}
                      inputMode="numeric"
                      value={ports[engine] ?? ""}
                      onChange={(event) =>
                        setPorts((current) => ({
                          ...current,
                          [engine]: event.target.value,
                        }))
                      }
                      placeholder={String(DEFAULT_PORTS[engine])}
                    />
                  </div>
                ))}
              </div>
            </div>

            {host ? (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="maintenance">
                    {t("admin-infra:shared.maintenance")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "admin-infra:databases.hostDialog.maintenanceDescription",
                    )}
                  </p>
                </div>
                <Switch
                  id="maintenance"
                  checked={maintenance}
                  onCheckedChange={setMaintenance}
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || isPending}
              loading={isPending}
            >
              {host || registration
                ? t("common:resources.saveChanges")
                : t("admin-infra:databases.hostDialog.registerButton")}
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}
