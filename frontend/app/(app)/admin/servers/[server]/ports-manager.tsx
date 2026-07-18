"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  availablePorts,
  addPort,
  deletePort,
  listNodes,
  serverInfo,
  updatePort,
  type AvailablePortsResponse,
  type NetworkProtocol,
} from "@/lib/api";
import { extractAdminPorts, type AdminPortRow } from "./port-utils";

type PortsManagerProps = {
  serverId: string;
  nodeId: string;
  initialPorts: AdminPortRow[];
  canManage: boolean;
};

type PortFormState = {
  name: string;
  protocol: NetworkProtocol;
  internalPort: string;
  externalStart: string;
  externalEnd: string;
  host: string;
  bind: string;
};

const EMPTY_FORM: PortFormState = {
  name: "",
  protocol: "tcp",
  internalPort: "",
  externalStart: "",
  externalEnd: "",
  host: "",
  bind: "",
};

type SelectablePortRange = {
  end: number;
  exclude?: number[];
  protocol: NetworkProtocol;
  start: number;
};

type PortFormErrors = Partial<Record<keyof PortFormState, string>>;

function formFromPort(port: AdminPortRow): PortFormState {
  return {
    name: port.name,
    protocol: port.protocol,
    internalPort: String(port.internalPort),
    externalStart: String(port.externalStart),
    externalEnd: String(port.externalEnd),
    host: port.host,
    bind: port.bind ?? "",
  };
}

function formatPortRange(range: SelectablePortRange) {
  const base =
    range.start === range.end
      ? `${range.protocol.toUpperCase()} ${range.start}`
      : `${range.protocol.toUpperCase()} ${range.start}-${range.end}`;

  return range.exclude?.length
    ? `${base} excluding ${range.exclude.join(", ")}`
    : base;
}

function parseInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function PortsManager({
  serverId,
  nodeId,
  initialPorts,
  canManage,
}: PortsManagerProps) {
  const [ports, setPorts] = useState<AdminPortRow[]>(initialPorts);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<PortFormState>(EMPTY_FORM);
  const [hasSubmittedForm, setHasSubmittedForm] = useState(false);
  const [availablePortMap, setAvailablePortMap] =
    useState<AvailablePortsResponse | null>(null);
  const [nodePortProtocols, setNodePortProtocols] = useState<
    Record<string, NetworkProtocol>
  >({});
  const [selectedPort, setSelectedPort] = useState<AdminPortRow | null>(null);

  const selectedPortId = useMemo(
    () => selectedPort?.id ?? null,
    [selectedPort],
  );

  const availablePortRanges = useMemo<SelectablePortRange[]>(() => {
    if (!availablePortMap) {
      return [];
    }

    return Object.entries(availablePortMap).flatMap(([portId, ranges]) => {
      const protocol = nodePortProtocols[portId];
      if (!protocol) {
        return [];
      }

      return ranges.map((range) => ({
        end: range.end,
        exclude: range.exclude,
        protocol,
        start: range.start,
      }));
    });
  }, [availablePortMap, nodePortProtocols]);

  const refreshAvailablePorts = useCallback(async () => {
    try {
      const [nodesResponse, portsResponse] = await Promise.all([
        listNodes(),
        availablePorts({
          path: { node_id: nodeId },
        }),
      ]);

      const currentNode = nodesResponse.error
        ? null
        : (nodesResponse.data ?? []).find((entry) => entry.id === nodeId);

      setNodePortProtocols(
        Object.fromEntries(
          (currentNode?.ports ?? []).map((port) => [
            String(port.id),
            port.protocol,
          ]),
        ),
      );

      setAvailablePortMap(
        portsResponse.error || !portsResponse.data ? null : portsResponse.data,
      );
    } catch {
      setAvailablePortMap(null);
      setNodePortProtocols({});
    }
  }, [nodeId]);

  const refreshPorts = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await serverInfo({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error("Failed to load server port data");
      }

      setPorts(extractAdminPorts(response.data));
      await refreshAvailablePorts();
    } catch {
      toast.error("Failed to refresh ports");
    } finally {
      setIsLoading(false);
    }
  }, [refreshAvailablePorts, serverId]);

  useEffect(() => {
    void refreshAvailablePorts();
  }, [refreshAvailablePorts]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setHasSubmittedForm(false);
    setSelectedPort(null);
  };

  const isExternalPortRangeAllowed = (
    externalStart: number,
    externalEnd: number,
    protocol: NetworkProtocol,
  ) => {
    if (availablePortRanges.length === 0) {
      return true;
    }

    if (
      selectedPort &&
      selectedPort.protocol === protocol &&
      selectedPort.externalStart === externalStart &&
      selectedPort.externalEnd === externalEnd
    ) {
      return true;
    }

    return availablePortRanges.some((range) => {
      if (
        range.protocol !== protocol ||
        externalStart < range.start ||
        externalEnd > range.end
      ) {
        return false;
      }

      const excluded = new Set(range.exclude ?? []);
      for (let port = externalStart; port <= externalEnd; port += 1) {
        if (excluded.has(port)) {
          return false;
        }
      }

      return true;
    });
  };

  const getFormErrors = () => {
    const errors: PortFormErrors = {};
    const internalPort = parseInteger(form.internalPort);
    const externalStart = parseInteger(form.externalStart);
    const externalEnd = parseInteger(form.externalEnd);

    if (!form.name.trim()) {
      errors.name = "Name is required.";
    }

    if (internalPort === null || internalPort <= 0) {
      errors.internalPort = "Enter a valid internal port.";
    }

    if (externalStart === null || externalStart <= 0) {
      errors.externalStart = "Enter a valid external start port.";
    }

    if (externalEnd === null || externalEnd <= 0) {
      errors.externalEnd = "Enter a valid external end port.";
    } else if (externalStart !== null && externalEnd < externalStart) {
      errors.externalEnd = "End port must be greater than or equal to start.";
    }

    if (
      externalStart !== null &&
      externalEnd !== null &&
      externalStart > 0 &&
      externalEnd >= externalStart &&
      !isExternalPortRangeAllowed(externalStart, externalEnd, form.protocol)
    ) {
      errors.externalStart = `Selected ${form.protocol.toUpperCase()} range is not available.`;
      errors.externalEnd = `Selected ${form.protocol.toUpperCase()} range is not available.`;
    }

    return errors;
  };

  const validateForm = () => {
    setHasSubmittedForm(true);
    const errors = getFormErrors();
    if (Object.keys(errors).length > 0) {
      return null;
    }

    const internalPort = Number(form.internalPort);
    const externalStart = Number(form.externalStart);
    const externalEnd = Number(form.externalEnd);

    return {
      name: form.name.trim(),
      protocol: form.protocol,
      internalPort,
      externalStart,
      externalEnd,
      host: form.host.trim(),
      bind: form.bind.trim(),
    };
  };
  const formErrors = getFormErrors();
  const visibleFormErrors: PortFormErrors = {
    ...(hasSubmittedForm ? formErrors : {}),
    ...(form.externalStart || form.externalEnd
      ? {
          externalStart: formErrors.externalStart,
          externalEnd: formErrors.externalEnd,
        }
      : {}),
  };

  const handleCreate = async () => {
    const values = validateForm();
    if (!values) {
      return;
    }

    setIsActionLoading(true);

    try {
      const response = await addPort({
        path: { server_id: serverId },
        body: {
          name: values.name,
          protocol: values.protocol,
          internal_port: values.internalPort,
          external_port: {
            start: values.externalStart,
            end: values.externalEnd,
          },
        },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to create port");
        return;
      }

      toast.success("Port added");
      setCreateOpen(false);
      resetForm();
      await refreshPorts();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUpdate = async () => {
    const values = validateForm();
    if (!values || selectedPortId === null) {
      return;
    }

    setIsActionLoading(true);

    try {
      const response = await updatePort({
        path: { server_id: serverId, port_id: selectedPortId },
        body: {
          name: values.name,
          protocol: values.protocol,
          internal_port: values.internalPort,
          host: values.host || null,
          bind: values.bind || null,
          external_port: {
            start: values.externalStart,
            end: values.externalEnd,
          },
        },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to update port");
        return;
      }

      toast.success("Port updated");
      setEditOpen(false);
      resetForm();
      await refreshPorts();
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
      const response = await deletePort({
        path: { server_id: serverId, port_id: selectedPortId },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to remove port");
        return;
      }

      toast.success("Port removed");
      setDeleteOpen(false);
      resetForm();
      await refreshPorts();
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Ports</CardTitle>
          <CardDescription>
            Add, update, and remove server ports exposed through the API.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" disabled={isActionLoading}>
                Available ranges
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <div className="space-y-2">
                <p className="text-sm font-medium">Available port ranges</p>
                {availablePortRanges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No available range data.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {availablePortRanges.map((range, index) => (
                      <p
                        key={`${range.protocol}-${range.start}-${range.end}-${index}`}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {formatPortRange(range)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
            disabled={isActionLoading || !canManage}
          >
            <Plus className="size-4" />
            Add Port
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refreshPorts();
            }}
            disabled={isActionLoading || isLoading}
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {ports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ports available from the API response yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Internal</TableHead>
                  <TableHead>External</TableHead>
                  <TableHead>Host / Bind</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ports.map((port) => (
                  <TableRow key={port.id}>
                    <TableCell className="font-medium">{port.name}</TableCell>
                    <TableCell className="uppercase">{port.protocol}</TableCell>
                    <TableCell>{port.internalPort}</TableCell>
                    <TableCell>
                      {port.externalStart === port.externalEnd
                        ? port.externalStart
                        : `${port.externalStart}-${port.externalEnd}`}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {port.host}
                      {port.bind ? ` (${port.bind})` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedPort(port);
                            setForm(formFromPort(port));
                            setEditOpen(true);
                          }}
                          disabled={isActionLoading || !canManage}
                        >
                          <Pencil className="size-4" />
                          Edit
                        </Button>
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Port</DialogTitle>
            <DialogDescription>
              Configure a new network port allocation for this server.
            </DialogDescription>
          </DialogHeader>
          <PortForm
            errors={visibleFormErrors}
            form={form}
            setForm={setForm}
            mode="create"
          />
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

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Port</DialogTitle>
            <DialogDescription>
              Update the selected server port settings.
            </DialogDescription>
          </DialogHeader>
          <PortForm
            errors={visibleFormErrors}
            form={form}
            setForm={setForm}
            mode="edit"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={isActionLoading || !canManage}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleUpdate();
              }}
              loading={isActionLoading}
              disabled={!canManage}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove port?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {selectedPort?.name ?? "the selected port"} from the
              server.
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
    </Card>
  );
}

type PortFormProps = {
  errors: PortFormErrors;
  form: PortFormState;
  setForm: React.Dispatch<React.SetStateAction<PortFormState>>;
  mode: "create" | "edit";
};

function FieldError({ children }: { children?: string }) {
  if (!children) {
    return null;
  }

  return <p className="text-sm text-destructive">{children}</p>;
}

function PortForm({ errors, form, setForm, mode }: PortFormProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <Input
          value={form.name}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, name: event.target.value }))
          }
          placeholder="Name"
          aria-invalid={Boolean(errors.name)}
        />
        <FieldError>{errors.name}</FieldError>
      </div>

      <Select
        value={form.protocol}
        onValueChange={(value) =>
          setForm((prev) => ({ ...prev, protocol: value as NetworkProtocol }))
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Protocol" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tcp">TCP</SelectItem>
          <SelectItem value="udp">UDP</SelectItem>
        </SelectContent>
      </Select>

      <div className="space-y-2">
        <Input
          value={form.internalPort}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, internalPort: event.target.value }))
          }
          placeholder="Internal port"
          inputMode="numeric"
          aria-invalid={Boolean(errors.internalPort)}
        />
        <FieldError>{errors.internalPort}</FieldError>
      </div>

      <div className="space-y-2">
        <Input
          value={form.externalStart}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, externalStart: event.target.value }))
          }
          placeholder="External start"
          inputMode="numeric"
          aria-invalid={Boolean(errors.externalStart)}
        />
        <FieldError>{errors.externalStart}</FieldError>
      </div>

      <div className="space-y-2">
        <Input
          value={form.externalEnd}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, externalEnd: event.target.value }))
          }
          placeholder="External end"
          inputMode="numeric"
          aria-invalid={Boolean(errors.externalEnd)}
        />
        <FieldError>{errors.externalEnd}</FieldError>
      </div>

      {mode === "edit" ? (
        <>
          <Input
            value={form.host}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, host: event.target.value }))
            }
            placeholder="Host (optional)"
          />

          <Input
            value={form.bind}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, bind: event.target.value }))
            }
            placeholder="Bind (optional)"
          />
        </>
      ) : null}
    </div>
  );
}
