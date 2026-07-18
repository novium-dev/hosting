"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

function formatAvailablePortValue(value: AvailablePortValue) {
  if (value.length === 0) {
    return "No available ports";
  }

  return value
    .map((range) => {
      const { start, end, exclude } = range;
      const rangeStr = start === end ? `${start}` : `${start}-${end}`;
      if (exclude && exclude.length > 0) {
        return `${rangeStr} (exclude: ${exclude.join(", ")})`;
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
      toast.error("Failed to refresh node ports");
    } finally {
      setIsLoading(false);
    }
  }, [nodeId]);

  const handleCreate = async () => {
    const start = Number(form.start);
    const end = Number(form.end);

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start <= 0 ||
      end < start
    ) {
      toast.error("Please provide a valid port range");
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
        toast.error(response.error.error?.msg ?? "Failed to add port range");
        return;
      }

      toast.success("Port range added");
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
        toast.error(response.error.error?.msg ?? "Failed to remove port");
        return;
      }

      toast.success("Port removed");
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
            <CardTitle>Allocated Ports</CardTitle>
            <CardDescription>
              Add and remove node port ranges from the admin API.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={isActionLoading || !canManage}
            >
              <Plus className="size-4" />
              Add Port Range
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
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {ports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No allocated ports.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                          Remove
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
          <CardTitle>Available Ports</CardTitle>
          <CardDescription>
            Snapshot returned by the available ports endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(available).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No available port data.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(available).map(([key, value]) => (
                <div key={key} className="rounded-md border px-3 py-2 text-sm">
                  <p className="font-medium">{key}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatAvailablePortValue(value)}
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
            <DialogTitle>Add Port Range</DialogTitle>
            <DialogDescription>
              Allocate a port range to this node.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={form.start}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, start: event.target.value }))
              }
              placeholder="Start"
              inputMode="numeric"
            />
            <Input
              value={form.end}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, end: event.target.value }))
              }
              placeholder="End"
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
                <SelectValue placeholder="Protocol" />
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
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreate();
              }}
              loading={isActionLoading}
              disabled={!canManage}
            >
              Add
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
            <AlertDialogTitle>Remove port range?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes range{" "}
              {selectedPort ? `${selectedPort.start}-${selectedPort.end}` : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading || !canManage}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
