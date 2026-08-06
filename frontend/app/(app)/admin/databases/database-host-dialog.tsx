"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createDatabaseHost,
  updateDatabaseHost,
  type DatabaseType,
} from "@/lib/api";
import { DATABASE_TYPE_LABELS } from "@/components/databases/database-type";
import type { DatabaseHostRow, RegionRow } from "./database-hosts-table";

const ENGINES = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

/** Falls back to the agent's own defaults when a port is left blank. */
const DEFAULT_PORTS: Record<DatabaseType, number> = {
  postgres: 5432,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
};

export function DatabaseHostDialog({
  open,
  onOpenChange,
  host,
  regions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing host when set, otherwise registering a new one. */
  host?: DatabaseHostRow;
  regions: RegionRow[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [display, setDisplay] = useState("");
  const [region, setRegion] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [publicHost, setPublicHost] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [ports, setPorts] = useState<Record<string, string>>({});
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!open) return;

    setDisplay(host?.display ?? "");
    setRegion(host?.region ?? regions[0]?.id ?? "");
    setUrl(host?.url ?? "");
    setToken("");
    setPublicHost(host?.public_host ?? "");
    setMaintenance(host?.maintenance ?? false);
    setPorts(
      Object.fromEntries(
        ENGINES.map((engine) => [
          engine,
          host?.ports?.[engine] ? String(host.ports[engine]) : "",
        ]),
      ),
    );
  }, [open, host, regions]);

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

  const submit = async () => {
    setIsPending(true);
    try {
      const response = host
        ? await updateDatabaseHost({
            path: { host_id: host.id },
            body: {
              display,
              region,
              url,
              public_host: publicHost,
              maintenance,
              ports: collectPorts(),
              ...(token ? { token } : {}),
            },
          })
        : await createDatabaseHost({
            body: {
              display,
              region,
              url,
              token,
              public_host: publicHost,
              ports: collectPorts(),
            },
          });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:databases.hostDialog.saveError"),
        );
        return;
      }

      toast.success(
        host
          ? t("admin-infra:databases.hostDialog.updateSuccess")
          : t("admin-infra:databases.hostDialog.registerSuccess"),
      );
      onOpenChange(false);
      onSaved();
    } finally {
      setIsPending(false);
    }
  };

  const canSubmit =
    display.trim() !== "" &&
    region !== "" &&
    url.trim() !== "" &&
    publicHost.trim() !== "" &&
    (host !== undefined || token.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {host
              ? t("admin-infra:databases.hostDialog.editTitle")
              : t("admin-infra:databases.hostDialog.registerTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin-infra:databases.hostDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <Label htmlFor="region">{t("common:labels.region")}</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger id="region" className="w-full">
                <SelectValue
                  placeholder={t("admin-infra:shared.selectRegionPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {regions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.display}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">
              {t("admin-infra:databases.hostDialog.urlLabel")}
            </Label>
            <Input
              id="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://10.0.0.10:8090"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">
              {t("admin-infra:databases.hostDialog.tokenLabel")}
              {host
                ? ` ${t("admin-infra:databases.hostDialog.tokenLabelKeepHint")}`
                : ""}
            </Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                host
                  ? t("admin-infra:databases.hostDialog.tokenPlaceholderUnchanged")
                  : t("admin-infra:databases.hostDialog.tokenPlaceholderHint")
              }
            />
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
            <Label>{t("admin-infra:databases.hostDialog.publicPortsLabel")}</Label>
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
                  {t("admin-infra:databases.hostDialog.maintenanceDescription")}
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
            {host
              ? t("common:resources.saveChanges")
              : t("admin-infra:databases.hostDialog.registerButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
