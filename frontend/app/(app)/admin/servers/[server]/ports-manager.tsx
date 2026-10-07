"use client";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
  type NetworkProtocol,
} from "@/lib/api";
import { extractAdminPorts, type AdminPortRow } from "./port-utils";
import { formatPortRange, type SelectablePortRange } from "@/lib/ports";

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
  http: boolean;
};

const EMPTY_FORM: PortFormState = {
  name: "",
  protocol: "tcp",
  internalPort: "",
  externalStart: "",
  externalEnd: "",
  host: "",
  bind: "",
  http: false,
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
    http: port.http,
  };
}

function parseInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

const NO_PROTOCOLS: Record<string, NetworkProtocol> = {};

export function PortsManager({
  serverId,
  nodeId,
  initialPorts,
  canManage,
}: PortsManagerProps) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<AdminPortRow[]>(initialPorts);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [form, setForm] = useState<PortFormState>(EMPTY_FORM);
  const [hasSubmittedForm, setHasSubmittedForm] = useState(false);
  const { data: availability, mutate: refreshAvailablePorts } = useSWR(
    ["admin/server-port-availability", nodeId],
    async () => {
      const [nodesResponse, portsResponse] = await Promise.all([
        listNodes(),
        availablePorts({
          path: { node_id: nodeId },
        }),
      ]);

      const currentNode = nodesResponse.error
        ? null
        : (nodesResponse.data ?? []).find((entry) => entry.id === nodeId);

      return {
        protocols: Object.fromEntries(
          (currentNode?.ports ?? []).map((port) => [
            String(port.id),
            port.protocol,
          ]),
        ) as Record<string, NetworkProtocol>,
        map:
          portsResponse.error || !portsResponse.data
            ? null
            : portsResponse.data,
      };
    },
  );
  const availablePortMap = availability?.map ?? null;
  const nodePortProtocols = availability?.protocols ?? NO_PROTOCOLS;
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
      toast.error(t("admin-infra:servers.portsManager.refreshError"));
    } finally {
      setIsLoading(false);
    }
  }, [refreshAvailablePorts, serverId, t]);

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
      errors.name = t("admin-infra:servers.portsManager.errors.nameRequired");
    }

    if (internalPort === null || internalPort <= 0) {
      errors.internalPort = t(
        "admin-infra:servers.portsManager.errors.invalidInternalPort",
      );
    }

    if (externalStart === null || externalStart <= 0) {
      errors.externalStart = t(
        "admin-infra:servers.portsManager.errors.invalidExternalStart",
      );
    }

    if (externalEnd === null || externalEnd <= 0) {
      errors.externalEnd = t(
        "admin-infra:servers.portsManager.errors.invalidExternalEnd",
      );
    } else if (externalStart !== null && externalEnd < externalStart) {
      errors.externalEnd = t(
        "admin-infra:servers.portsManager.errors.endBeforeStart",
      );
    }

    if (
      externalStart !== null &&
      externalEnd !== null &&
      externalStart > 0 &&
      externalEnd >= externalStart &&
      !isExternalPortRangeAllowed(externalStart, externalEnd, form.protocol)
    ) {
      const rangeNotAvailable = t(
        "admin-infra:servers.portsManager.errors.rangeNotAvailable",
        { protocol: form.protocol.toUpperCase() },
      );
      errors.externalStart = rangeNotAvailable;
      errors.externalEnd = rangeNotAvailable;
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
      http: form.http && form.protocol === "tcp",
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
          http: values.http,
          external_port: {
            start: values.externalStart,
            end: values.externalEnd,
          },
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:servers.portsManager.createError"),
        );
        return;
      }

      toast.success(t("admin-infra:servers.portsManager.createSuccess"));
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
          http: values.http,
          host: values.host || null,
          bind: values.bind || null,
          external_port: {
            start: values.externalStart,
            end: values.externalEnd,
          },
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:servers.portsManager.updateError"),
        );
        return;
      }

      toast.success(t("admin-infra:servers.portsManager.updateSuccess"));
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
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:servers.portsManager.removeError"),
        );
        return;
      }

      toast.success(t("admin-infra:servers.portsManager.removeSuccess"));
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
          <CardTitle>{t("common:nav.ports")}</CardTitle>
          <CardDescription>
            {t("admin-infra:servers.portsManager.description")}
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={isActionLoading}
                />
              }
            >
              {t("admin-infra:servers.shared.availableRanges")}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t("admin-infra:servers.shared.availablePortRangesTitle")}
                </p>
                {availablePortRanges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("admin-infra:servers.portsManager.noRangeData")}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {availablePortRanges.map((range, index) => (
                      <p
                        key={`${range.protocol}-${range.start}-${range.end}-${index}`}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {formatPortRange(range, t)}
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
            {t("admin-infra:servers.portsManager.addButton")}
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
            {t("common:actions.refresh")}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {ports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:servers.portsManager.noPorts")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>{t("admin-infra:shared.protocol")}</TableHead>
                  <TableHead>
                    {t("admin-infra:servers.portsManager.columns.internal")}
                  </TableHead>
                  <TableHead>
                    {t("admin-infra:servers.portsManager.columns.external")}
                  </TableHead>
                  <TableHead>Host / Bind</TableHead>
                  <TableHead className="text-right">
                    {t("common:labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ports.map((port) => (
                  <TableRow key={port.id}>
                    <TableCell className="font-medium">{port.name}</TableCell>
                    <TableCell className="uppercase">
                      {port.http ? "http" : port.protocol}
                    </TableCell>
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
                          {t("common:actions.edit")}
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
                          {t("common:actions.remove")}
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
            <DialogTitle>
              {t("admin-infra:servers.portsManager.addButton")}
            </DialogTitle>
            <DialogDescription>
              {t("admin-infra:servers.portsManager.addDialogDescription")}
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
            <DialogTitle>
              {t("admin-infra:servers.portsManager.editDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin-infra:servers.portsManager.editDialogDescription")}
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
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleUpdate();
              }}
              loading={isActionLoading}
              disabled={!canManage}
            >
              {t("common:actions.save")}
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
            <AlertDialogTitle>
              {t("admin-infra:servers.portsManager.removeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:servers.portsManager.removeDialogDescription", {
                name:
                  selectedPort?.name ??
                  t("admin-infra:servers.portsManager.removeDialogDefaultName"),
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
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <Input
          value={form.name}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, name: event.target.value }))
          }
          placeholder={t(
            "admin-infra:servers.portsManager.form.namePlaceholder",
          )}
          aria-invalid={Boolean(errors.name)}
        />
        <FieldError>{errors.name}</FieldError>
      </div>

      <div className="space-y-2">
        <Select
          items={[
            { value: "tcp", label: t("common:resources.tcp") },
            { value: "udp", label: t("common:resources.udp") },
            { value: "http", label: t("common:resources.http") },
          ]}
          value={form.http ? "http" : form.protocol}
          onValueChange={(value) =>
            setForm((prev) =>
              value === "http"
                ? { ...prev, protocol: "tcp", http: true }
                : { ...prev, protocol: value as NetworkProtocol, http: false },
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("admin-infra:shared.protocol")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tcp">{t("common:resources.tcp")}</SelectItem>
            <SelectItem value="udp">{t("common:resources.udp")}</SelectItem>
            <SelectItem value="http">{t("common:resources.http")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("admin-infra:servers.portsManager.form.httpHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Input
          value={form.internalPort}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, internalPort: event.target.value }))
          }
          placeholder={t(
            "admin-infra:servers.portsManager.form.internalPortPlaceholder",
          )}
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
          placeholder={t(
            "admin-infra:servers.portsManager.form.externalStartPlaceholder",
          )}
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
          placeholder={t(
            "admin-infra:servers.portsManager.form.externalEndPlaceholder",
          )}
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
            placeholder={t(
              "admin-infra:servers.portsManager.form.hostPlaceholder",
            )}
          />

          <Input
            value={form.bind}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, bind: event.target.value }))
            }
            placeholder={t(
              "admin-infra:servers.portsManager.form.bindPlaceholder",
            )}
          />
        </>
      ) : null}
    </div>
  );
}
