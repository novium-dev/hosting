"use client";

import Link from "@/components/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/lib/navigation";
import { useAction } from "@/lib/action-hooks";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
  useVariableEditor,
  VariableFields,
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
import { availablePorts, listNodeGroups } from "@/lib/api";
import type { GroupOption } from "@/lib/groups";
import type {
  AvailablePortsResponse,
  NodePortAllocation,
  TemplateInfoResponse,
} from "@/lib/api";

const NO_GROUP = "__none__";

type ProjectOption = {
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

function formatProjectLabel(project: ProjectOption) {
  return `${project.name} (${project.slug})`;
}

function getPortUsageKey(protocol: string, port: number) {
  return `${protocol}:${port}`;
}

/**
 * A set of port definitions that has to be given one and the same external
 * port.
 *
 * A non-remappable port must be reachable under the very number players dial,
 * so the definitions describing it — typically the TCP and the UDP half of one
 * game port, recognisable by a shared internal port — can only be picked
 * together. Remappable ports are a group of their own.
 */
type PortGroup = {
  key: string;
  internalPort: number;
  label: string;
  portKeys: string[];
  protocols: string[];
  remappable: boolean;
};

function buildPortGroups(definitions: TemplatePortDefinitions): PortGroup[] {
  const groups = new Map<string, PortGroup>();

  for (const [portKey, definition] of Object.entries(definitions)) {
    const groupKey = definition.remappable
      ? `port:${portKey}`
      : `fixed:${definition.internal_port}`;
    const group = groups.get(groupKey);

    if (group) {
      group.portKeys.push(portKey);
      if (!group.protocols.includes(definition.protocol)) {
        group.protocols.push(definition.protocol);
      }
      continue;
    }

    groups.set(groupKey, {
      key: groupKey,
      internalPort: definition.internal_port,
      label: definition.placeholder,
      portKeys: [portKey],
      protocols: [definition.protocol],
      remappable: definition.remappable,
    });
  }

  // The backend serialises the definitions from a hash map, so without an
  // explicit order both the labels and the assigned defaults would move around
  // between requests.
  return [...groups.values()]
    .map((group) => ({
      ...group,
      portKeys: [...group.portKeys].sort(),
      protocols: [...group.protocols].sort(),
    }))
    .sort(
      (a, b) =>
        a.internalPort - b.internalPort || a.portKeys[0]!.localeCompare(b.portKeys[0]!),
    );
}

function isPortFreeForGroup(
  group: PortGroup,
  port: number,
  allowedRanges: SelectablePortRange[],
  usedPorts: Set<string>,
) {
  return group.protocols.every((protocol) => {
    if (usedPorts.has(getPortUsageKey(protocol, port))) {
      return false;
    }

    return allowedRanges.some(
      (range) =>
        range.protocol === protocol &&
        port >= range.start &&
        port <= range.end &&
        !(range.exclude ?? []).includes(port),
    );
  });
}

function findFreePort(
  group: PortGroup,
  allowedRanges: SelectablePortRange[],
  usedPorts: Set<string>,
) {
  const matchingRanges = allowedRanges
    .filter((range) => group.protocols.includes(range.protocol))
    .sort((a, b) => a.start - b.start);

  for (const range of matchingRanges) {
    for (let port = range.start; port <= range.end; port += 1) {
      if (isPortFreeForGroup(group, port, allowedRanges, usedPorts)) {
        return port;
      }
    }
  }

  if (matchingRanges[0]) {
    return matchingRanges[0].start;
  }

  return group.internalPort;
}

function buildDefaultPorts(
  definitions: TemplatePortDefinitions,
  allowedRanges: SelectablePortRange[],
) {
  const usedPorts = new Set<string>();
  const defaultPorts: Record<string, number> = {};

  for (const group of buildPortGroups(definitions)) {
    const port = findFreePort(group, allowedRanges, usedPorts);

    for (const portKey of group.portKeys) {
      defaultPorts[portKey] = port;
    }
    for (const protocol of group.protocols) {
      usedPorts.add(getPortUsageKey(protocol, port));
    }
  }

  return defaultPorts;
}

function formatPortRange(range: SelectablePortRange, t: TFunction) {
  const base =
    range.start === range.end
      ? `${range.protocol.toUpperCase()} ${range.start}`
      : `${range.protocol.toUpperCase()} ${range.start}-${range.end}`;

  return range.exclude?.length
    ? t("admin-infra:servers.shared.rangeExcluding", {
        base,
        exclude: range.exclude.join(", "),
      })
    : base;
}

function buildPortOptions({
  allowedRanges,
  definitions,
  group,
  hasConfiguredPortRanges,
  ports,
}: {
  allowedRanges: SelectablePortRange[];
  definitions: TemplatePortDefinitions;
  group: PortGroup;
  hasConfiguredPortRanges: boolean;
  ports: Record<string, number>;
}) {
  const currentPort = ports[group.portKeys[0]!] ?? group.internalPort;
  const usedPorts = new Set(
    Object.entries(ports)
      .filter(([key]) => !group.portKeys.includes(key))
      .flatMap(([key, port]) => {
        const protocol = definitions[key]?.protocol;
        return protocol ? [getPortUsageKey(protocol, port)] : [];
      }),
  );

  if (!hasConfiguredPortRanges) {
    return [{ label: String(currentPort), value: currentPort }];
  }

  const options: PortOption[] = [];
  const seen = new Set<number>();
  const ranges = allowedRanges
    .filter((range) => group.protocols.includes(range.protocol))
    .sort((a, b) => a.start - b.start);

  for (const range of ranges) {
    for (let port = range.start; port <= range.end; port += 1) {
      if (options.length >= MAX_PORT_OPTIONS) {
        return options;
      }

      if (seen.has(port)) {
        continue;
      }
      seen.add(port);

      // A grouped port is only usable when every protocol of the group can be
      // bound to it.
      if (!isPortFreeForGroup(group, port, allowedRanges, usedPorts)) {
        continue;
      }

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
  projects,
  templates,
  nodes,
}: {
  projects: ProjectOption[];
  templates: string[];
  nodes: NodeOption[];
}) {
  const { t } = useTranslation(["admin-infra", "common"]);
  const router = useRouter();
  const canViewSecrets = true;

  const [name, setName] = useState("");
  const [owner, setOwner] = useState<string>(projects[0]?.id ?? "");
  const [template, setTemplate] = useState<string>(templates[0] ?? "");
  const [node, setNode] = useState<string>(nodes[0]?.id ?? "");
  const [storage, setStorage] = useState(nodes[0]?.serverStorages?.[0] ?? "");
  const [group, setGroup] = useState(NO_GROUP);
  const [nodeGroups, setNodeGroups] = useState<GroupOption[]>([]);

  const [cpu, setCpu] = useState("1");
  const [ram, setRam] = useState("1024");
  const [disk, setDisk] = useState("4096");
  const [swap, setSwap] = useState("0");
  const [backupLimit, setBackupLimit] = useState("0");
  const [internetAccess, setInternetAccess] = useState(true);

  const [ports, setPorts] = useState<Record<string, number>>({});
  const [templateDetails, setTemplateDetails] =
    useState<TemplateInfoResponse | null>(null);

  const {
    errors: variableErrors,
    nestedPath,
    onNestedChange,
    reset: resetVariables,
    setVariables,
    variables,
  } = useVariableEditor(templateDetails?.variables ?? null);
  const [availablePortMap, setAvailablePortMap] =
    useState<AvailablePortsResponse | null>(null);
  const [ownerComboboxOpen, setOwnerComboboxOpen] = useState(false);

  const selectedNode = useMemo(() => {
    return nodes.find((entry) => entry.id === node) ?? null;
  }, [nodes, node]);


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
    setGroup(NO_GROUP);
    setNodeGroups([]);
    if (!selectedNode) {
      return;
    }

    let isActive = true;

    listNodeGroups({ path: { node_id: selectedNode.id } })
      .then((response) => {
        if (isActive && !response.error && response.data) {
          setNodeGroups(
            response.data.map(({ id, label }) => ({ id, label })),
          );
        }
      })
      .catch(() => {});

    return () => {
      isActive = false;
    };
  }, [selectedNode]);

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
        toast.success(t("admin-infra:servers.createForm.createSuccess"));
        router.push("/admin/servers");
      }
    },
    onError: ({ error }) => {
      toast.error(
        error.serverError || t("admin-infra:servers.createForm.createError"),
      );
    },
  });

  useEffect(() => {
    if (!template) {
      setTemplateDetails(null);
      resetVariables(null);
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
          resetVariables(null);
          setPorts({});
          return;
        }

        resetVariables(info.variables);
        setTemplateDetails(info);
      })
      .catch(() => {
        toast.error(t("admin-infra:servers.createForm.loadTemplateInfoError"));
      });
  }, [template, executeTemplateInfo, resetVariables, t]);

  useEffect(() => {
    if (!templateDetails) {
      return;
    }

    setPorts(buildDefaultPorts(templateDetails.ports, allowedPortRanges));
  }, [templateDetails, allowedPortRanges]);

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === owner);
  }, [projects, owner]);

  const portGroups = useMemo(() => {
    return templateDetails ? buildPortGroups(templateDetails.ports) : [];
  }, [templateDetails]);

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

    for (const group of portGroups) {
      const value = ports[group.portKeys[0]!];
      if (value === undefined) {
        continue;
      }

      const blocked = group.protocols.find(
        (protocol) => !isPortAllowed(value, protocol),
      );
      if (blocked) {
        errors[group.key] = t(
          "admin-infra:servers.createForm.errors.portOutsideRange",
          { port: value, protocol: blocked.toUpperCase(), node },
        );
        continue;
      }

      const taken = group.protocols.find((protocol) =>
        usedPorts.has(getPortUsageKey(protocol, value)),
      );
      if (taken) {
        errors[group.key] = t(
          "admin-infra:servers.createForm.errors.portAlreadySelected",
          { port: value, protocol: taken.toUpperCase() },
        );
        continue;
      }

      for (const protocol of group.protocols) {
        usedPorts.add(getPortUsageKey(protocol, value));
      }
    }

    return errors;
  };

  const portErrors = getPortErrors();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      toast.error(t("admin-infra:servers.createForm.fillRequiredError"));
      return;
    }

    const portValidationError = validatePorts();
    if (portValidationError) {
      return;
    }

    if (Object.keys(variableErrors).length > 0) {
      toast.error(t("admin-infra:servers.createForm.invalidVariablesError"));
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
      backupLimit: toNullableNumber(backupLimit),
      group: group === NO_GROUP ? null : Number(group),
      variables: variablesAsStrings,
      ports,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {t("admin-infra:servers.shared.createServerLabel")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:servers.createForm.subtitle")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/servers">
            <ArrowLeft className="size-4" />
            {t("admin-infra:servers.createForm.backToServers")}
          </Link>
        </Button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border p-4 md:p-6"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">
              {t("admin-infra:servers.createForm.serverNameLabel")}
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t(
                "admin-infra:servers.createForm.serverNamePlaceholder",
              )}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>{t("admin-infra:servers.createForm.ownerLabel")}</Label>
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
                  {selectedProject
                    ? formatProjectLabel(selectedProject)
                    : t(
                        "admin-infra:servers.createForm.selectProjectPlaceholder",
                      )}
                  <ChevronsUpDown className="size-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-(--radix-popover-trigger-width) p-0"
                align="start"
              >
                <Command>
                  <CommandInput
                    placeholder={t(
                      "admin-infra:servers.createForm.searchProjectPlaceholder",
                    )}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {t("admin-infra:servers.createForm.noProjectFound")}
                    </CommandEmpty>
                    <CommandGroup>
                      {projects.map((project) => (
                        <CommandItem
                          key={project.id}
                          value={`${project.name} ${project.slug} ${project.id}`}
                          onSelect={() => {
                            setOwner(project.id);
                            setOwnerComboboxOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 size-4",
                              owner === project.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span>{formatProjectLabel(project)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>{t("admin-infra:servers.shared.templateLabel")}</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t(
                    "admin-infra:servers.createForm.selectTemplatePlaceholder",
                  )}
                />
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
            <Label>{t("admin-infra:servers.shared.nodeLabel")}</Label>
            <Select value={node} onValueChange={setNode}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t(
                    "admin-infra:servers.createForm.selectNodePlaceholder",
                  )}
                />
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
            <Label htmlFor="storage">
              {t("admin-infra:servers.createForm.storageLabel")}
            </Label>
            <Select value={storage} onValueChange={setStorage}>
              <SelectTrigger id="storage" className="w-full">
                <SelectValue
                  placeholder={t(
                    "admin-infra:servers.createForm.selectStoragePlaceholder",
                  )}
                />
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
            <Label htmlFor="group">
              {t("admin-infra:servers.shared.groupLabel")}
            </Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger id="group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>
                  {t("admin-infra:servers.shared.noGroup")}
                </SelectItem>
                {nodeGroups.map((groupOption) => (
                  <SelectItem
                    key={groupOption.id}
                    value={String(groupOption.id)}
                  >
                    {groupOption.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="internet-access">
              {t("admin-infra:servers.shared.internetAccessLabel")}
            </Label>
            <Select
              value={internetAccess ? "enabled" : "disabled"}
              onValueChange={(value) => setInternetAccess(value === "enabled")}
            >
              <SelectTrigger id="internet-access" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">
                  {t("common:status.enabled")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("common:status.disabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-base font-semibold">
            {t("admin-infra:servers.createForm.resourcesTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:servers.createForm.resourcesHint")}
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="cpu">
                {t("admin-infra:servers.createForm.cpuLabel")}
              </Label>
              <Input
                id="cpu"
                type="number"
                min={0}
                step={0.1}
                value={cpu}
                onChange={(event) => setCpu(event.target.value)}
                placeholder={t("admin-infra:servers.createForm.cpuPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ram">
                {t("admin-infra:servers.createForm.ramLabel")}
              </Label>
              <Input
                id="ram"
                type="number"
                min={0}
                value={ram}
                onChange={(event) => setRam(event.target.value)}
                placeholder={t("admin-infra:servers.createForm.ramPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="swap">
                {t("admin-infra:servers.createForm.swapLabel")}
              </Label>
              <Input
                id="swap"
                type="number"
                min={0}
                value={swap}
                onChange={(event) => setSwap(event.target.value)}
                placeholder={t(
                  "admin-infra:servers.createForm.swapPlaceholder",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disk">
                {t("admin-infra:servers.createForm.diskLabel")}
              </Label>
              <Input
                id="disk"
                type="number"
                min={0}
                value={disk}
                onChange={(event) => setDisk(event.target.value)}
                placeholder={t(
                  "admin-infra:servers.createForm.diskPlaceholder",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-limit">
                {t("admin-infra:servers.shared.backupLimitLabel")}
              </Label>
              <Input
                id="backup-limit"
                type="number"
                min={0}
                value={backupLimit}
                onChange={(event) => setBackupLimit(event.target.value)}
                placeholder={t(
                  "admin-infra:servers.createForm.backupLimitPlaceholder",
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin-infra:servers.createForm.backupLimitHint")}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-base font-semibold">
            {t("admin-infra:servers.createForm.templateVariablesTitle")}
          </h2>
          {!template ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:servers.createForm.selectTemplateFirst")}
            </p>
          ) : templateInfoAction.isExecuting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("admin-infra:servers.createForm.loadingTemplateDetails")}
            </div>
          ) : !templateDetails ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:servers.createForm.noTemplateDetails")}
            </p>
          ) : (
            <VariableFields
              canViewSecrets
              errors={variableErrors}
              nestedPath={nestedPath}
              onNestedChange={onNestedChange}
              payload={templateDetails.variables}
              setVariables={setVariables}
              variables={variables}
            />
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-base font-semibold">
            {t("common:nav.ports")}
          </h2>
          {allowedPortRanges.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {t("admin-infra:servers.shared.availableRanges")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t("admin-infra:servers.shared.availablePortRangesTitle")}
                  </p>
                  <div className="space-y-1">
                    {allowedPortRanges.map((range, index) => (
                      <p
                        key={`${range.protocol}-${range.start}-${range.end}-${index}`}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {formatPortRange(range, t)}
                      </p>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {!templateDetails ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:servers.createForm.selectTemplateForPorts")}
            </p>
          ) : Object.keys(templateDetails.ports).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:servers.createForm.noConfigurablePorts")}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {portGroups.map((group) => {
                const selectedPort =
                  ports[group.portKeys[0]!] ?? group.internalPort;
                const portOptions = buildPortOptions({
                  allowedRanges: allowedPortRanges,
                  definitions: templateDetails.ports,
                  group,
                  hasConfiguredPortRanges,
                  ports,
                });
                const setGroupPort = (nextPort: number) => {
                  setPorts((prev) => ({
                    ...prev,
                    ...Object.fromEntries(
                      group.portKeys.map((portKey) => [portKey, nextPort]),
                    ),
                  }));
                };

                return (
                  <div key={group.key} className="space-y-2">
                    <Label htmlFor={group.key}>
                      {group.label} (
                      {group.protocols
                        .map((protocol) => protocol.toUpperCase())
                        .join(" + ")}
                      {group.remappable
                        ? t("admin-infra:servers.createForm.internalPortSuffix", {
                            port: group.internalPort,
                          })
                        : ""}
                      )
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

                        setGroupPort(nextPort);
                      }}
                      onValueChange={(value) => {
                        if (typeof value !== "number") {
                          return;
                        }

                        setGroupPort(value);
                      }}
                    >
                      <ComboboxInput
                        id={group.key}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder={t(
                          "admin-infra:servers.createForm.selectOrEnterPortPlaceholder",
                        )}
                        aria-invalid={Boolean(portErrors[group.key])}
                        className="w-full"
                      />
                      <ComboboxContent>
                        <ComboboxEmpty>
                          {t("admin-infra:servers.createForm.noAvailablePortFound")}
                        </ComboboxEmpty>
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
                    {portErrors[group.key] && (
                      <p className="text-sm text-destructive">
                        {portErrors[group.key]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!canSubmit}
            loading={createServer.isExecuting}
          >
            {t("admin-infra:servers.shared.createServerLabel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
