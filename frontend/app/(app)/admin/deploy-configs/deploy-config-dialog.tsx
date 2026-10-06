import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  useVariableEditor,
  VariableFields,
  variableValuesToStrings,
  type VariablePayloadLike,
} from "@/components/server/variables-editor";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  createDeployConfig,
  templateInfo,
  updateDeployConfig,
  type DeployConfigPayload,
} from "@/lib/api";
import type { DeployConfig } from "@/types/api";
import type { GroupRef } from "@/lib/api";

type DeployConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DeployConfig | null;
  groups: GroupRef[];
  templates: string[];
  onSaved: () => void;
};

type FormState = {
  name: string;
  group: string;
  template: string;
  cpu: string;
  ram: string;
  swap: string;
  disk: string;
  backupLimit: string;
  internetAccess: boolean;
};

function initialForm(config: DeployConfig | null): FormState {
  return {
    name: config?.name ?? "",
    group: config ? String(config.group.id) : "",
    template: config?.template ?? "",
    cpu: config ? String(config.cpu) : "1",
    ram: config ? String(config.ram) : "1024",
    swap: config ? String(config.swap) : "0",
    disk: config?.disk != null ? String(config.disk) : "",
    backupLimit: config?.backup_limit != null ? String(config.backup_limit) : "",
    internetAccess: config?.internet_access ?? true,
  };
}

function withCurrentValues(
  payload: VariablePayloadLike,
  values: Record<string, string>,
): VariablePayloadLike {
  return {
    ...payload,
    groups: payload.groups.map((group) => ({
      ...group,
      variables: group.variables.map((variable) =>
        variable.id in values
          ? { ...variable, current: values[variable.id] }
          : variable,
      ),
    })),
  };
}

function parseInteger(value: string, min: number): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isInteger(number) && number >= min ? number : undefined;
}

export function DeployConfigDialog({
  open,
  onOpenChange,
  config,
  groups,
  templates,
  onSaved,
}: DeployConfigDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() => initialForm(config));
  const [payload, setPayload] = useState<VariablePayloadLike | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const {
    errors: variableErrors,
    nestedPath,
    onNestedChange,
    reset: resetVariables,
    setVariables,
    variables,
  } = useVariableEditor(payload);

  useEffect(() => {
    if (open) setForm(initialForm(config));
  }, [open, config]);

  useEffect(() => {
    if (!open || !form.template) {
      setPayload(null);
      resetVariables(null);
      return;
    }

    let isActive = true;
    setIsLoadingTemplate(true);

    templateInfo({ path: { template: form.template } })
      .then((response) => {
        if (!isActive) return;
        if (response.error || !response.data) {
          setPayload(null);
          resetVariables(null);
          return;
        }
        const next =
          config && config.template === form.template
            ? withCurrentValues(response.data.variables, config.variables)
            : response.data.variables;
        setPayload(next);
        resetVariables(next);
      })
      .catch(() => {
        if (isActive) {
          setPayload(null);
          resetVariables(null);
        }
      })
      .finally(() => {
        if (isActive) setIsLoadingTemplate(false);
      });

    return () => {
      isActive = false;
    };
  }, [open, form.template, config, resetVariables]);

  const handleSave = async () => {
    const name = form.name.trim();
    const cpu = Number(form.cpu.trim());
    const ram = parseInteger(form.ram, 1);
    const swap = parseInteger(form.swap, 0);
    const disk = parseInteger(form.disk, 1);
    const backupLimit = parseInteger(form.backupLimit, 0);

    if (!name || !form.group || !form.template) {
      toast.error(t("admin-infra:deployConfigs.dialog.missingFields"));
      return;
    }
    if (
      !Number.isFinite(cpu) ||
      cpu <= 0 ||
      ram == null ||
      swap == null ||
      disk === undefined ||
      backupLimit === undefined
    ) {
      toast.error(t("admin-infra:deployConfigs.dialog.invalidResources"));
      return;
    }
    if (!payload || Object.keys(variableErrors).length > 0) {
      toast.error(t("admin-infra:deployConfigs.dialog.invalidVariables"));
      return;
    }

    const body: DeployConfigPayload = {
      name,
      group: Number(form.group),
      template: form.template,
      variables: variableValuesToStrings(variables),
      cpu,
      ram,
      swap,
      disk,
      backup_limit: backupLimit,
      internet_access: form.internetAccess,
    };

    setIsSaving(true);
    try {
      const response = config
        ? await updateDeployConfig({ path: { config_id: config.id }, body })
        : await createDeployConfig({ body });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:deployConfigs.dialog.saveError"),
        );
        return;
      }

      toast.success(t("admin-infra:deployConfigs.dialog.saveSuccess"));
      onOpenChange(false);
      onSaved();
    } finally {
      setIsSaving(false);
    }
  };

  const numberField = (
    id: keyof FormState,
    label: string,
    inputMode: "numeric" | "decimal",
    placeholder?: string,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={`deploy-config-${id}`}>{label}</Label>
      <Input
        id={`deploy-config-${id}`}
        value={String(form[id])}
        onChange={(event) =>
          setForm((prev) => ({ ...prev, [id]: event.target.value }))
        }
        inputMode={inputMode}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {config
              ? t("admin-infra:deployConfigs.dialog.editTitle", {
                  name: config.name,
                })
              : t("admin-infra:deployConfigs.dialog.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("admin-infra:deployConfigs.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="deploy-config-name">
                {t("common:labels.name")}
              </Label>
              <Input
                id="deploy-config-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deploy-config-group">
                {t("admin-infra:deployConfigs.groupLabel")}
              </Label>
              <Select
                value={form.group}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, group: value }))
                }
              >
                <SelectTrigger id="deploy-config-group" className="w-full">
                  <SelectValue
                    placeholder={t(
                      "admin-infra:deployConfigs.dialog.selectGroup",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deploy-config-template">
                {t("common:labels.template")}
              </Label>
              <Select
                value={form.template}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, template: value }))
                }
              >
                <SelectTrigger id="deploy-config-template" className="w-full">
                  <SelectValue
                    placeholder={t(
                      "admin-infra:deployConfigs.dialog.selectTemplate",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template} value={template}>
                      {template}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {numberField(
              "cpu",
              t("admin-infra:nodes.groupsManager.cpuLabel"),
              "decimal",
            )}
            {numberField(
              "ram",
              t("admin-infra:nodes.groupsManager.ramLabel"),
              "numeric",
            )}
            {numberField(
              "swap",
              t("admin-infra:nodes.groupsManager.swapLabel"),
              "numeric",
            )}
            {numberField(
              "disk",
              t("admin-infra:deployConfigs.diskLabel"),
              "numeric",
              t("admin-infra:nodes.groupsManager.unlimited"),
            )}
            {numberField(
              "backupLimit",
              t("admin-infra:servers.shared.backupLimitLabel"),
              "numeric",
              t("admin-infra:nodes.groupsManager.unlimited"),
            )}
            <div className="flex items-center justify-between gap-2 rounded-md border px-3">
              <Label htmlFor="deploy-config-internet">
                {t("admin-infra:servers.shared.internetAccessLabel")}
              </Label>
              <Switch
                id="deploy-config-internet"
                checked={form.internetAccess}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, internetAccess: checked }))
                }
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              {t("admin-infra:servers.createForm.templateVariablesTitle")}
            </h3>
            {!form.template ? (
              <p className="text-sm text-muted-foreground">
                {t("admin-infra:servers.createForm.selectTemplateFirst")}
              </p>
            ) : isLoadingTemplate ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("admin-infra:servers.createForm.loadingTemplateDetails")}
              </div>
            ) : !payload ? (
              <p className="text-sm text-muted-foreground">
                {t("admin-infra:servers.createForm.noTemplateDetails")}
              </p>
            ) : (
              <VariableFields
                canViewSecrets
                errors={variableErrors}
                nestedPath={nestedPath}
                onNestedChange={onNestedChange}
                payload={payload}
                setVariables={setVariables}
                variables={variables}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            loading={isSaving}
            disabled={isLoadingTemplate}
          >
            {config ? t("common:actions.save") : t("common:actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
