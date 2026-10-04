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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  updateMaintenance,
  updateNode,
  updateNodeOverallocation,
  type ListNodesResponses,
} from "@/lib/api";

type NodeRow = ListNodesResponses[200][number];

type NodeSettingsCardProps = {
  nodeId: string;
  display: string;
  defaultHost: string;
  defaultBind: string;
  backupStorages: NodeRow["backup_storages"];
  serverStorages: NodeRow["server_storages"];
  initialMaintenance: boolean;
  initialOverallocation: number;
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
  initialOverallocation,
  canManage,
}: NodeSettingsCardProps) {
  const { t } = useTranslation();
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [isMaintenanceSaving, setIsMaintenanceSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [overallocation, setOverallocation] = useState(
    String(initialOverallocation),
  );
  const [savedOverallocation, setSavedOverallocation] = useState(
    initialOverallocation,
  );
  const [isOverallocationSaving, setIsOverallocationSaving] = useState(false);

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

  const handleSaveOverallocation = async () => {
    const value = Number(overallocation.trim());
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      toast.error(t("admin-infra:nodes.settingsCard.overallocationInvalid"));
      return;
    }

    setIsOverallocationSaving(true);

    try {
      const response = await updateNodeOverallocation({
        path: { node_id: nodeId },
        body: value,
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.settingsCard.overallocationError"),
        );
        return;
      }

      setSavedOverallocation(value);
      toast.success(t("admin-infra:nodes.settingsCard.overallocationSuccess"));
    } finally {
      setIsOverallocationSaving(false);
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
            <p className="text-sm font-medium">
              {t("admin-infra:nodes.settingsCard.overallocationTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:nodes.settingsCard.overallocationDescription")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-32">
              <Input
                value={overallocation}
                onChange={(event) => setOverallocation(event.target.value)}
                inputMode="numeric"
                className="pr-7"
                disabled={!canManage}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void handleSaveOverallocation();
              }}
              loading={isOverallocationSaving}
              disabled={
                !canManage ||
                overallocation.trim() === String(savedOverallocation)
              }
            >
              {t("common:actions.save")}
            </Button>
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
