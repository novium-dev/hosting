"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  updateMaintenance,
  updateNode,
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
  canManage,
}: NodeSettingsCardProps) {
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [isMaintenanceSaving, setIsMaintenanceSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const maintenanceLabel = useMemo(
    () => (maintenance ? "Maintenance enabled" : "Maintenance disabled"),
    [maintenance],
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
          response.error.error?.msg ?? "Failed to update maintenance mode",
        );
        return;
      }

      setMaintenance(checked);
      toast.success(
        checked
          ? "Node maintenance has been enabled"
          : "Node maintenance has been disabled",
      );
    } finally {
      setIsMaintenanceSaving(false);
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
          response.error.error?.msg ?? "Failed to sync node config",
        );
        return;
      }

      toast.success("Node config synced from daemon");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Node Update</CardTitle>
        <CardDescription>
          Manage maintenance mode and sync node config from the running daemon.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem label="Display" value={display} />
          <InfoItem label="Default Host" value={defaultHost} />
          <InfoItem label="Default Bind" value={defaultBind} />
          <InfoItem label="Node ID" value={nodeId} mono />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={maintenance ? "destructive" : "default"}>
            {maintenanceLabel}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Servers on this node are blocked while maintenance is enabled.
          </span>
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Maintenance Mode</p>
            <p className="text-sm text-muted-foreground">
              Toggle maintenance mode for this node.
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
              {isMaintenanceSaving ? "Saving..." : maintenanceLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Sync Config</p>
            <p className="text-sm text-muted-foreground">
              Pull the current config from the running node (base URL, host/bind,
              storage and backup mappings) and reconcile it into the backend.
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
              Sync from Node
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <InfoItem
            label="Backup Storages"
            value={backupStorages.length > 0 ? backupStorages.join(", ") : "--"}
          />
          <InfoItem
            label="Server Storages"
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
