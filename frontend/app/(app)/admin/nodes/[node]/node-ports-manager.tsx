"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addNodePort,
  availablePorts,
  deleteNodePort,
  listNodes,
  type ListNodesResponses,
  type NetworkProtocol,
} from "@/lib/api";

type NodeRow = ListNodesResponses[200][number];
type NodePortRow = NodeRow["ports"][number];
type AvailablePortRangeValue = {
  start: number;
  end: number;
  exclude?: number[];
};

// [ { start: 1000, end: 10000, exclude: [] } ]
type AvailablePortValue = {
  start: number;
  end: number;
  exclude?: number[];
}[];
type AvailablePortMap = Record<string, AvailablePortValue>;

type NodePortsManagerProps = {
  nodeId: string;
  initialPorts: NodePortRow[];
  initialAvailablePorts: AvailablePortMap;
  canManage: boolean;
};

type PortRangeForm = {
  start: string;
  end: string;
  protocol: NetworkProtocol;
};

const EMPTY_FORM: PortRangeForm = {
  start: "",
  end: "",
  protocol: "tcp",
};

function formatAvailablePortValue(value: AvailablePortValue, t: TFunction) {
  if (value.length === 0) {
    return t("admin-infra:nodes.portsManager.noAvailablePorts");
  }

  return value
    .map((range) => {
      const { start, end, exclude } = range;
      const rangeStr = start === end ? `${start}` : `${start}-${end}`;
      if (exclude && exclude.length > 0) {
        return t("admin-infra:nodes.portsManager.rangeExclude", {
          range: rangeStr,
          exclude: exclude.join(", "),
        });
      }
      return rangeStr;
    })
    .join("; ");
}

export function NodePortsManager({
  nodeId,
  initialPorts,
  initialAvailablePorts,
  canManage,
}: NodePortsManagerProps) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<NodePortRow[]>(
    [...initialPorts].sort((a, b) => a.start - b.start),
  );
  const [available, setAvailable] = useState<AvailablePortMap>(
    initialAvailablePorts,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<PortRangeForm>(EMPTY_FORM);
  const [selectedPort, setSelectedPort] = useState<NodePortRow | null>(null);

  const selectedPortId = useMemo(
    () => selectedPort?.id ?? null,
    [selectedPort],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const [nodesResponse, availableResponse] = await Promise.all([
        listNodes(),
        availablePorts({ path: { node_id: nodeId } }),
      ]);

      if (nodesResponse.error || !nodesResponse.data) {
        throw new Error("Failed to load node list");
      }

      const node = nodesResponse.data.find((entry) => entry.id === nodeId);
      if (!node) {
        throw new Error("Node not found");
      }

      setPorts([...node.ports].sort((a, b) => a.start - b.start));
      setAvailable(
        availableResponse.error || !availableResponse.data
          ? {}
          : availableResponse.data,
      );
    } catch {
      toast.error(t("admin-infra:nodes.portsManager.refreshError"));
    } finally {
      setIsLoading(false);
    }
  }, [nodeId, t]);

  const handleCreate = async () => {
    const start = Number(form.start);
    const end = Number(form.end);

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start <= 0 ||
      end < start
    ) {
      toast.error(t("admin-infra:nodes.portsManager.invalidRangeError"));
      return;
    }

    setIsActionLoading(true);

    try {
      const response = await addNodePort({
        path: { node_id: nodeId },
        body: {
          protocol: form.protocol,
          start,
          end,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.portsManager.addError"),
        );
        return;
      }

      toast.success(t("admin-infra:nodes.portsManager.addSuccess"));
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await refresh();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (selectedPortId === null) {
      return;
    }

    setIsActionLoading(true);

    try {
      const response = await deleteNodePort({
        path: {
          node_id: nodeId,
          port_id: selectedPortId,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.portsManager.removeError"),
        );
        return;
      }

      toast.success(t("admin-infra:nodes.portsManager.removeSuccess"));
      setDeleteOpen(false);
      setSelectedPort(null);
      await refresh();
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>
              {t("admin-infra:nodes.portsManager.allocatedTitle")}
            </CardTitle>
            <CardDescription>
              {t("admin-infra:nodes.portsManager.allocatedDescription")}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={isActionLoading || !canManage}
            >
              <Plus className="size-4" />
              {t("admin-infra:nodes.portsManager.addButtonTitle")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void refresh();
              }}
              disabled={isActionLoading || isLoading}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              {t("common:actions.refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:nodes.portsManager.noAllocatedPorts")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.id")}</TableHead>
                    <TableHead>{t("admin-infra:shared.protocol")}</TableHead>
                    <TableHead>
                      {t("admin-infra:nodes.portsManager.columns.range")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("common:labels.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ports.map((port) => (
                    <TableRow key={port.id}>
                      <TableCell className="font-mono text-xs">
                        {port.id}
                      </TableCell>
                      <TableCell className="uppercase">
                        {port.protocol}
                      </TableCell>
                      <TableCell>
                        {port.start === port.end
                          ? port.start
                          : `${port.start}-${port.end}`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setSelectedPort(port);
                            setDeleteOpen(true);
                          }}
                          disabled={isActionLoading || !canManage}
                        >
                          <Trash2 className="size-4" />
                          {t("common:actions.remove")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin-infra:nodes.portsManager.availableTitle")}</CardTitle>
          <CardDescription>
            {t("admin-infra:nodes.portsManager.availableDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(available).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:nodes.portsManager.noAvailableData")}
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(available).map(([key, value]) => (
                <div key={key} className="rounded-md border px-3 py-2 text-sm">
                  <p className="font-medium">{key}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatAvailablePortValue(value, t)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin-infra:nodes.portsManager.addButtonTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin-infra:nodes.portsManager.addDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={form.start}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, start: event.target.value }))
              }
              placeholder={t("admin-infra:nodes.portsManager.startPlaceholder")}
              inputMode="numeric"
            />
            <Input
              value={form.end}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, end: event.target.value }))
              }
              placeholder={t("admin-infra:nodes.portsManager.endPlaceholder")}
              inputMode="numeric"
            />
            <Select
              value={form.protocol}
              onValueChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  protocol: value as NetworkProtocol,
                }))
              }
            >
              <SelectTrigger className="sm:col-span-2">
                <SelectValue placeholder={t("admin-infra:shared.protocol")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isActionLoading || !canManage}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreate();
              }}
              loading={isActionLoading}
              disabled={!canManage}
            >
              {t("common:actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setSelectedPort(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:nodes.portsManager.removeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:nodes.portsManager.removeDialogDescription", {
                range: selectedPort
                  ? `${selectedPort.start}-${selectedPort.end}`
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading || !canManage}
            >
              {t("common:actions.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
