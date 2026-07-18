"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronsUpDown,
  Loader2,
} from "lucide-react";

import { createServerAction, getTemplateInfoAction } from "@/actions/servers";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  applyNestedVariableChange,
  buildNestedVariableIndex,
  getInitialVariableState,
  getVariableErrors,
  type NestedVariablePointer,
  type VariableField,
  VariableFields,
  type VariableValue,
  variableValuesToStrings,
} from "@/components/server/variables-editor";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { availablePorts } from "@/lib/api";
import type {
  AvailablePortsResponse,
  NodePortAllocation,
  TemplateInfoResponse,
} from "@/lib/api";

type OrganizationOption = {
  id: string;
  name: string;
  slug: string;
};

type NodeOption = {
  id: string;
  display: string;
  serverStorages: string[];
  portAllocations: NodePortAllocation[];
};

type TemplatePortDefinitions = TemplateInfoResponse["ports"];
type SelectablePortRange = Pick<
  NodePortAllocation,
  "end" | "protocol" | "start"
> & {
  exclude?: number[];
};
type PortOption = {
  label: string;
  value: number;
};

const MAX_PORT_OPTIONS = 250;

function formatOrganizationLabel(org: OrganizationOption) {
  return `${org.name} (${org.slug})`;
}

function getPortUsageKey(protocol: string, port: number) {
  return `${protocol}:${port}`;
}

function findFreePort(
  definition: TemplatePortDefinitions[string],
  allowedRanges: SelectablePortRange[],
  usedPorts: Set<string>,
) {
  const matchingRanges = allowedRanges
    .filter((range) => range.protocol === definition.protocol)
    .sort((a, b) => a.start - b.start);

  for (const range of matchingRanges) {
    const excludedPorts = new Set(range.exclude ?? []);

    for (let port = range.start; port <= range.end; port += 1) {
      const usageKey = getPortUsageKey(definition.protocol, port);
      if (!excludedPorts.has(port) && !usedPorts.has(usageKey)) {
        return port;
      }
    }
  }

  if (matchingRanges[0]) {
    return matchingRanges[0].start;
  }

  return definition.internal_port;
}

function buildDefaultPorts(
  definitions: TemplatePortDefinitions,
  allowedRanges: SelectablePortRange[],
) {
  const usedPorts = new Set<string>();
  const defaultPorts: Record<string, number> = {};

  for (const [portKey, definition] of Object.entries(definitions)) {
    const port = findFreePort(definition, allowedRanges, usedPorts);
    defaultPorts[portKey] = port;
    usedPorts.add(getPortUsageKey(definition.protocol, port));
  }

  return defaultPorts;
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

function buildPortOptions({
  allowedRanges,
  definition,
  hasConfiguredPortRanges,
  portKey,
  ports,
}: {
  allowedRanges: SelectablePortRange[];
  definition: TemplatePortDefinitions[string];
  hasConfiguredPortRanges: boolean;
  portKey: string;
  ports: Record<string, number>;
}) {
  const currentPort = ports[portKey] ?? definition.internal_port;
  const usedPorts = new Set(
    Object.entries(ports)
      .filter(([key]) => key !== portKey)
      .map(([, port]) => getPortUsageKey(definition.protocol, port)),
  );

  if (!hasConfiguredPortRanges) {
    return [{ label: String(currentPort), value: currentPort }];
  }

  const options: PortOption[] = [];
  const seen = new Set<number>();
  const ranges = allowedRanges
    .filter((range) => range.protocol === definition.protocol)
    .sort((a, b) => a.start - b.start);

  for (const range of ranges) {
    const excludedPorts = new Set(range.exclude ?? []);

    for (let port = range.start; port <= range.end; port += 1) {
      if (options.length >= MAX_PORT_OPTIONS) {
        return options;
      }

      if (
        excludedPorts.has(port) ||
        seen.has(port) ||
        usedPorts.has(getPortUsageKey(definition.protocol, port))
      ) {
        continue;
      }

      seen.add(port);
      options.push({ label: String(port), value: port });
    }
  }

  return options;
}

function parsePortInput(value: string) {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function toNullableNumber(input: string): number | null {
  if (input.trim() === "") {
    return null;
  }

  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function ServerCreateForm({
  organizations,
  templates,
  nodes,
}: {
  organizations: OrganizationOption[];
  templates: string[];
  nodes: NodeOption[];
}) {
  const router = useRouter();
  const canViewSecrets = true;

  const [name, setName] = useState("");
  const [owner, setOwner] = useState<string>(organizations[0]?.id ?? "");
  const [template, setTemplate] = useState<string>(templates[0] ?? "");
  const [node, setNode] = useState<string>(nodes[0]?.id ?? "");
  const [storage, setStorage] = useState(nodes[0]?.serverStorages?.[0] ?? "");

  const [cpu, setCpu] = useState("");
  const [ram, setRam] = useState("");
  const [disk, setDisk] = useState("");
  const [swap, setSwap] = useState("0");
  const [internetAccess, setInternetAccess] = useState(true);

  const [variables, setVariables] = useState<Record<string, VariableValue>>({});
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [templateDetails, setTemplateDetails] =
    useState<TemplateInfoResponse | null>(null);
  const [availablePortMap, setAvailablePortMap] =
    useState<AvailablePortsResponse | null>(null);
  const [ownerComboboxOpen, setOwnerComboboxOpen] = useState(false);
  const [nestedPath, setNestedPath] = useState<Record<string, string>>({});

  const selectedNode = useMemo(() => {
    return nodes.find((entry) => entry.id === node) ?? null;
  }, [nodes, node]);

  const nestedVariableIndex = useMemo(
    () =>
      buildNestedVariableIndex(
        templateDetails ? templateDetails.variables : null,
      ),
    [templateDetails],
  );
  const variableErrors = getVariableErrors(
    templateDetails?.variables ?? null,
    variables,
  );

  const allowedPortRanges = useMemo<SelectablePortRange[]>(() => {
    if (!selectedNode) {
      return [];
    }

    if (!availablePortMap) {
      return selectedNode.portAllocations.map((range) => ({
        end: range.end,
        protocol: range.protocol,
        start: range.start,
      }));
    }

    return selectedNode.portAllocations.flatMap((allocation) => {
      const ranges = availablePortMap[String(allocation.id)];

      if (!ranges) {
        return [
          {
            end: allocation.end,
            protocol: allocation.protocol,
            start: allocation.start,
          },
        ];
      }

      return ranges.map((range) => ({
        end: range.end,
        exclude: range.exclude,
        protocol: allocation.protocol,
        start: range.start,
      }));
    });
  }, [availablePortMap, selectedNode]);
  const hasConfiguredPortRanges =
    (selectedNode?.portAllocations.length ?? 0) > 0;

  useEffect(() => {
    if (!selectedNode) {
      setStorage("");
      setAvailablePortMap(null);
      return;
    }

    if (!selectedNode.serverStorages.includes(storage)) {
      setStorage(selectedNode.serverStorages[0] ?? "");
    }
  }, [selectedNode, storage]);

  useEffect(() => {
    if (!selectedNode) {
      setAvailablePortMap(null);
      return;
    }

    let isActive = true;
    setAvailablePortMap(null);

    availablePorts({ path: { node_id: selectedNode.id } })
      .then((response) => {
        if (!isActive) {
          return;
        }

        setAvailablePortMap(
          response.error || !response.data ? null : response.data,
        );
      })
      .catch(() => {
        if (isActive) {
          setAvailablePortMap(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [selectedNode]);

  const templateInfoAction = useAction(getTemplateInfoAction);
  const executeTemplateInfo = templateInfoAction.executeAsync;
  const createServer = useAction(createServerAction, {
    onSuccess: (result) => {
      if (result.data?.success) {
        toast.success("Server created successfully");
        router.push("/admin/servers");
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || "Failed to create server");
    },
  });

  useEffect(() => {
    if (!template) {
      setTemplateDetails(null);
      setVariables({});
      setPorts({});
      return;
    }

    setTemplateDetails(null);
    setPorts({});

    executeTemplateInfo({ template })
      .then((result) => {
        const info = result?.data?.data;
        if (!info) {
          setTemplateDetails(null);
          setVariables({});
          setPorts({});
          return;
        }

        const initialState = getInitialVariableState(info.variables);

        setVariables(initialState.variables);
        setNestedPath(initialState.nestedPath);
        setTemplateDetails(info);
      })
      .catch(() => {
        toast.error("Failed to load template info");
      });
  }, [template, executeTemplateInfo]);

  useEffect(() => {
    if (!templateDetails) {
      return;
    }

    setPorts(buildDefaultPorts(templateDetails.ports, allowedPortRanges));
  }, [templateDetails, allowedPortRanges]);

  const selectedOrganization = useMemo(() => {
    return organizations.find((org) => org.id === owner);
  }, [organizations, owner]);

  const canSubmit =
    name.trim().length > 0 &&
    owner.length > 0 &&
    template.length > 0 &&
    node.length > 0 &&
    storage.length > 0;

  const isPortInAllowedRange = (value: number, protocol: string) => {
    return allowedPortRanges.some(
      (range) =>
        range.protocol === protocol &&
        value >= range.start &&
        value <= range.end &&
        !(range.exclude ?? []).includes(value),
    );
  };

  const isPortAllowed = (value: number, protocol: string) => {
    if (!hasConfiguredPortRanges) {
      return true;
    }

    return isPortInAllowedRange(value, protocol);
  };

  const validatePorts = () => {
    const errors = getPortErrors();
    return Object.values(errors)[0] ?? null;
  };

  const getPortErrors = () => {
    const usedPorts = new Set<string>();
    const errors: Record<string, string> = {};

    for (const [key, value] of Object.entries(ports)) {
      const definition = templateDetails?.ports[key];
      if (!definition) {
        continue;
      }

      if (!isPortAllowed(value, definition.protocol)) {
        errors[key] =
          `Port ${value} is outside the allowed ${definition.protocol.toUpperCase()} ranges for node ${node}.`;
        continue;
      }

      const usageKey = getPortUsageKey(definition.protocol, value);
      if (usedPorts.has(usageKey)) {
        errors[key] =
          `Port ${value} is already selected for another ${definition.protocol.toUpperCase()} port.`;
        continue;
      }
      usedPorts.add(usageKey);
    }

    return errors;
  };

  const portErrors = getPortErrors();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      toast.error("Please fill all required fields");
      return;
    }

    const portValidationError = validatePorts();
    if (portValidationError) {
      return;
    }

    const variableValidationErrors = getVariableErrors(
      templateDetails?.variables ?? null,
      variables,
    );
    if (Object.keys(variableValidationErrors).length > 0) {
      toast.error("Fix invalid template variables before creating the server");
      return;
    }

    const variablesAsStrings = variableValuesToStrings(variables);

    await createServer.executeAsync({
      name: name.trim(),
      owner,
      template,
      node,
      storage,
      internetAccess,
      cpu: toNullableNumber(cpu),
      ram: toNullableNumber(ram),
      disk: toNullableNumber(disk),
      swap: toNullableNumber(swap),
      variables: variablesAsStrings,
      ports,
    });
  };

  const onNestedVariableChange = (
    variable: VariableField,
    pointer: NestedVariablePointer,
    nextValue: string,
  ) => {
    applyNestedVariableChange({
      nestedIndex: nestedVariableIndex,
      pointer,
      setNestedPath,
      setVariables,
      value: nextValue,
      variable,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Create Server</h1>
          <p className="text-sm text-muted-foreground">
            Setup a new server from template defaults.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/servers">
            <ArrowLeft className="size-4" />
            Back to Servers
          </Link>
        </Button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border p-4 md:p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Server Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My game server"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Owner (Organization)</Label>
            <Popover
              open={ownerComboboxOpen}
              onOpenChange={setOwnerComboboxOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                >
                  {selectedOrganization
                    ? formatOrganizationLabel(selectedOrganization)
                    : "Select organization"}
                  <ChevronsUpDown className="size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-(--radix-popover-trigger-width) p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder="Search organization..." />
                  <CommandList>
                    <CommandEmpty>No organization found.</CommandEmpty>
                    <CommandGroup>
                      {organizations.map((org) => (
                        <CommandItem
                          key={org.id}
                          value={`${org.name} ${org.slug} ${org.id}`}
                          onSelect={() => {
                            setOwner(org.id);
                            setOwnerComboboxOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4",
                              owner === org.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span>{formatOrganizationLabel(org)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((templateName) => (
                  <SelectItem key={templateName} value={templateName}>
                    {templateName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Node</Label>
            <Select value={node} onValueChange={setNode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select node" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((nodeOption) => (
                  <SelectItem key={nodeOption.id} value={nodeOption.id}>
                    {nodeOption.display} ({nodeOption.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="storage">Storage</Label>
            <Select value={storage} onValueChange={setStorage}>
              <SelectTrigger id="storage" className="w-full">
                <SelectValue placeholder="Select storage" />
              </SelectTrigger>
              <SelectContent>
                {(selectedNode?.serverStorages ?? []).map((storageOption) => (
                  <SelectItem key={storageOption} value={storageOption}>
                    {storageOption}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="internet-access">Internet Access</Label>
            <Select
              value={internetAccess ? "enabled" : "disabled"}
              onValueChange={(value) => setInternetAccess(value === "enabled")}
            >
              <SelectTrigger id="internet-access" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-base font-semibold">Resources</h2>
          <p className="text-sm text-muted-foreground">
            Leave empty for template defaults/unlimited.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="ram">RAM (MB)</Label>
              <Input
                id="ram"
                type="number"
                min={0}
                value={ram}
                onChange={(event) => setRam(event.target.value)}
                placeholder="e.g. 2048"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disk">Disk (MB)</Label>
              <Input
                id="disk"
                type="number"
                min={0}
                value={disk}
                onChange={(event) => setDisk(event.target.value)}
                placeholder="e.g. 10240"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpu">CPU</Label>
              <Input
                id="cpu"
                type="number"
                min={0}
                step={0.1}
                value={cpu}
                onChange={(event) => setCpu(event.target.value)}
                placeholder="e.g. 2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="swap">Swap (MB)</Label>
              <Input
                id="swap"
                type="number"
                min={0}
                value={swap}
                onChange={(event) => setSwap(event.target.value)}
                placeholder="e.g. 1024"
              />
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-base font-semibold">Template Variables</h2>
          {!template ? (
            <p className="text-sm text-muted-foreground">
              Select a template first.
            </p>
          ) : templateInfoAction.isExecuting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading template details...
            </div>
          ) : !templateDetails ? (
            <p className="text-sm text-muted-foreground">
              No template details available.
            </p>
          ) : (
            <VariableFields
              canViewSecrets
              errors={variableErrors}
              nestedPath={nestedPath}
              onNestedChange={onNestedVariableChange}
              payload={templateDetails.variables}
              setVariables={setVariables}
              variables={variables}
            />
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-base font-semibold">Ports</h2>
          {allowedPortRanges.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Available ranges
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Available port ranges</p>
                  <div className="space-y-1">
                    {allowedPortRanges.map((range, index) => (
                      <p
                        key={`${range.protocol}-${range.start}-${range.end}-${index}`}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {formatPortRange(range)}
                      </p>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {!templateDetails ? (
            <p className="text-sm text-muted-foreground">
              Select a template to configure ports.
            </p>
          ) : Object.keys(templateDetails.ports).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No configurable ports for this template.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {Object.entries(templateDetails.ports).map(
                ([portKey, definition]) => {
                  const selectedPort =
                    ports[portKey] ?? definition.internal_port;
                  const portOptions = buildPortOptions({
                    allowedRanges: allowedPortRanges,
                    definition,
                    hasConfiguredPortRanges,
                    portKey,
                    ports,
                  });

                  return (
                    <div key={portKey} className="space-y-2">
                      <Label htmlFor={portKey}>
                        {definition.placeholder} (
                        {definition.protocol.toUpperCase()} / internal{" "}
                        {definition.internal_port})
                      </Label>
                      <Combobox
                        value={selectedPort}
                        inputValue={String(selectedPort)}
                        itemToStringLabel={(port) => String(port)}
                        itemToStringValue={(port) => String(port)}
                        onInputValueChange={(value) => {
                          const nextPort = parsePortInput(value);

                          if (nextPort === null) {
                            return;
                          }

                          setPorts((prev) => ({
                            ...prev,
                            [portKey]: nextPort,
                          }));
                        }}
                        onValueChange={(value) => {
                          if (typeof value !== "number") {
                            return;
                          }

                          setPorts((prev) => ({
                            ...prev,
                            [portKey]: value,
                          }));
                        }}
                      >
                        <ComboboxInput
                          id={portKey}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="Select or enter port"
                          aria-invalid={Boolean(portErrors[portKey])}
                          className="w-full"
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>No available port found.</ComboboxEmpty>
                          <ComboboxList>
                            <ComboboxGroup>
                              {portOptions.map((option) => (
                                <ComboboxItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </ComboboxItem>
                              ))}
                            </ComboboxGroup>
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      {portErrors[portKey] && (
                        <p className="text-sm text-destructive">
                          {portErrors[portKey]}
                        </p>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!canSubmit}
            loading={createServer.isExecuting}
          >
            Create Server
          </Button>
        </div>
      </form>
    </div>
  );
}
