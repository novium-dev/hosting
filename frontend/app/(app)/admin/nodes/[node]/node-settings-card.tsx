"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  updateMaintenance,
  updateNode,
  updateNodeRegion,
  type ListNodesResponses,
  type ListRegionsResponses,
} from "@/lib/api";

type NodeRow = ListNodesResponses[200][number];
type RegionRow = ListRegionsResponses[200][number];

type NodeSettingsCardProps = {
  nodeId: string;
  display: string;
  defaultHost: string;
  defaultBind: string;
  backupStorages: NodeRow["backup_storages"];
  serverStorages: NodeRow["server_storages"];
  initialMaintenance: boolean;
  initialRegion: string;
  regions: RegionRow[];
  canManage: boolean;
};

export function NodeSettingsCard({
  nodeId,
  display,
  defaultHost,
  defaultBind,
  backupStorages,
  serverStorages,
  initialMaintenance,
  initialRegion,
  regions,
  canManage,
}: NodeSettingsCardProps) {
  const { t } = useTranslation();
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [isMaintenanceSaving, setIsMaintenanceSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [region, setRegion] = useState(initialRegion);
  const [isRegionSaving, setIsRegionSaving] = useState(false);

  const maintenanceLabel = useMemo(
    () =>
      maintenance
        ? t("admin-infra:nodes.settingsCard.maintenanceEnabled")
        : t("admin-infra:nodes.settingsCard.maintenanceDisabled"),
    [maintenance, t],
  );

  const handleToggleMaintenance = async (checked: boolean) => {
    setIsMaintenanceSaving(true);

    try {
      const response = await updateMaintenance({
        path: { node_id: nodeId },
        body: checked,
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.settingsCard.maintenanceToggleError"),
        );
        return;
      }

      setMaintenance(checked);
      toast.success(
        checked
          ? t("admin-infra:nodes.settingsCard.maintenanceEnabledToast")
          : t("admin-infra:nodes.settingsCard.maintenanceDisabledToast"),
      );
    } finally {
      setIsMaintenanceSaving(false);
    }
  };

  const handleChangeRegion = async (next: string) => {
    setIsRegionSaving(true);

    try {
      const response = await updateNodeRegion({
        path: { node_id: nodeId },
        body: next,
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.settingsCard.regionError"),
        );
        return;
      }

      setRegion(next);
      toast.success(t("admin-infra:nodes.settingsCard.regionSuccess"));
    } finally {
      setIsRegionSaving(false);
    }
  };

  const handleSyncNode = async () => {
    setIsSyncing(true);

    try {
      const response = await updateNode({
        path: { node_id: nodeId },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.settingsCard.syncError"),
        );
        return;
      }

      toast.success(t("admin-infra:nodes.settingsCard.syncSuccess"));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin-infra:nodes.settingsCard.title")}</CardTitle>
        <CardDescription>
          {t("admin-infra:nodes.settingsCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem
            label={t("admin-infra:nodes.settingsCard.displayLabel")}
            value={display}
          />
          <InfoItem
            label={t("admin-infra:nodes.shared.defaultHost")}
            value={defaultHost}
          />
          <InfoItem
            label={t("admin-infra:nodes.shared.defaultBind")}
            value={defaultBind}
          />
          <InfoItem
            label={t("admin-infra:nodes.shared.nodeId")}
            value={nodeId}
            mono
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={maintenance ? "destructive" : "default"}>
            {maintenanceLabel}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {t("admin-infra:nodes.settingsCard.maintenanceWarning")}
          </span>
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t("admin-infra:nodes.settingsCard.maintenanceModeTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:nodes.settingsCard.maintenanceModeDescription")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={maintenance}
              onCheckedChange={(checked) => {
                void handleToggleMaintenance(checked);
              }}
              disabled={isMaintenanceSaving || !canManage}
            />
            <span className="text-sm text-muted-foreground">
              {isMaintenanceSaving ? t("common:state.saving") : maintenanceLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("common:labels.region")}</p>
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:nodes.settingsCard.regionDescription")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Select
              value={region}
              onValueChange={(next) => {
                void handleChangeRegion(next);
              }}
              disabled={isRegionSaving || !canManage}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue
                  placeholder={t("admin-infra:shared.selectRegionPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {regions.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.display}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isRegionSaving ? (
              <span className="text-sm text-muted-foreground">
                {t("common:state.saving")}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t("admin-infra:nodes.settingsCard.syncConfigTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:nodes.settingsCard.syncConfigDescription")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void handleSyncNode();
              }}
              loading={isSyncing}
              disabled={!canManage}
            >
              <RefreshCw className="size-4" />
              {t("admin-infra:nodes.settingsCard.syncButton")}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <InfoItem
            label={t("admin-infra:nodes.settingsCard.backupStoragesLabel")}
            value={backupStorages.length > 0 ? backupStorages.join(", ") : "--"}
          />
          <InfoItem
            label={t("admin-infra:nodes.settingsCard.serverStoragesLabel")}
            value={serverStorages.length > 0 ? serverStorages.join(", ") : "--"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function InfoItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}
