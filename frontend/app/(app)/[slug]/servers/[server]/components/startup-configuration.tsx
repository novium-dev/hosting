"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { serverStartup, updateStartup } from "@/lib/api";
import { parseEnvFile } from "@/lib/env-file";

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENVIRONMENT_VARIABLES = 64;

type StartupConfigurationProps = {
  canEdit: boolean;
  serverId: string;
};

type StartupPayload = NonNullable<
  Awaited<ReturnType<typeof serverStartup>>["data"]
>;

type EnvironmentRow = {
  id: string;
  key: string;
  value: string;
};

let rowCounter = 0;

function createRow(key = "", value = ""): EnvironmentRow {
  rowCounter += 1;

  return { id: `env-${rowCounter}`, key, value };
}

function toRows(environment: Record<string, string>) {
  return Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => createRow(key, value));
}

function rowsEqual(left: EnvironmentRow[], right: EnvironmentRow[]) {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.key === right[index]?.key && row.value === right[index]?.value,
    )
  );
}

export function StartupConfiguration({
  canEdit,
  serverId,
}: StartupConfigurationProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [command, setCommand] = useState("");
  const [isSavingCommand, setIsSavingCommand] = useState(false);
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [savedRows, setSavedRows] = useState<EnvironmentRow[]>([]);
  const [isSavingEnvironment, setIsSavingEnvironment] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importContent, setImportContent] = useState("");

  const applyPayload = useCallback((next: StartupPayload) => {
    const nextRows = toRows(next.environment);

    setPayload(next);
    setCommand(next.command);
    setRows(nextRows);
    setSavedRows(nextRows);
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);

      try {
        const response = await serverStartup({
          path: { server_id: serverId },
        });

        if (response.error || !response.data) {
          throw new Error(t("servers:startupConfig.toasts.loadFailed"));
        }

        if (mounted) {
          applyPayload(response.data);
        }
      } catch {
        if (mounted) {
          toast.error(t("servers:startupConfig.toasts.loadFailed"));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [applyPayload, serverId, t]);

  const reserved = useMemo(
    () => new Set(payload?.reserved_environment ?? []),
    [payload],
  );

  const filledRows = useMemo(
    () => rows.filter((row) => row.key.trim().length > 0 || row.value.length > 0),
    [rows],
  );

  const rowErrors = useMemo(() => {
    const seen = new Map<string, number>();
    const errors: Record<string, string> = {};

    for (const row of filledRows) {
      const key = row.key.trim();

      if (key.length === 0) {
        errors[row.id] = t("servers:startupConfig.environment.errors.empty");
        continue;
      }

      if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
        errors[row.id] = t("servers:startupConfig.environment.errors.name");
        continue;
      }

      if (reserved.has(key)) {
        errors[row.id] = t("servers:startupConfig.environment.errors.reserved");
        continue;
      }

      const previous = seen.get(key);

      if (previous !== undefined) {
        errors[row.id] = t("servers:startupConfig.environment.errors.duplicate");
        continue;
      }

      seen.set(key, 1);
    }

    return errors;
  }, [filledRows, reserved, t]);

  const commandChanged = command !== (payload?.command ?? "");
  const environmentChanged = !rowsEqual(filledRows, savedRows);
  const hasRowErrors = Object.keys(rowErrors).length > 0;

  const saveCommand = async () => {
    if (!payload) {
      return;
    }

    setIsSavingCommand(true);

    try {
      const trimmed = command.trim();
      const response = await updateStartup({
        path: { server_id: serverId },
        body: {
          command: trimmed === payload.default_command.trim() ? "" : trimmed,
        },
      });

      if (response.error) {
        throw new Error(t("servers:startupConfig.toasts.saveFailed"));
      }

      const refreshed = await serverStartup({ path: { server_id: serverId } });

      if (refreshed.data) {
        applyPayload(refreshed.data);
      }

      toast.success(t("servers:startupConfig.toasts.commandSaved"));
    } catch {
      toast.error(t("servers:startupConfig.toasts.saveFailed"));
    } finally {
      setIsSavingCommand(false);
    }
  };

  const saveEnvironment = async () => {
    if (!payload) {
      return;
    }

    if (hasRowErrors) {
      toast.error(t("servers:startupConfig.toasts.environmentInvalid"));
      return;
    }

    setIsSavingEnvironment(true);

    try {
      const environment = Object.fromEntries(
        filledRows.map((row) => [row.key.trim(), row.value]),
      );

      const response = await updateStartup({
        path: { server_id: serverId },
        body: { environment },
      });

      if (response.error) {
        throw new Error(t("servers:startupConfig.toasts.saveFailed"));
      }

      setRows(filledRows);
      setSavedRows(filledRows);
      setPayload({ ...payload, environment });
      toast.success(t("servers:startupConfig.toasts.environmentSaved"));
    } catch {
      toast.error(t("servers:startupConfig.toasts.saveFailed"));
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const updateRow = (id: string, patch: Partial<EnvironmentRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const importVariables = (replace: boolean) => {
    const parsed = parseEnvFile(importContent);

    if (parsed.length === 0) {
      toast.error(t("servers:startupConfig.import.toasts.empty"));
      return;
    }

    setRows((current) => {
      const merged = new Map(
        replace ? [] : current.map((row) => [row.key.trim(), row] as const),
      );

      for (const [key, value] of parsed) {
        const existing = merged.get(key);

        merged.set(key, existing ? { ...existing, value } : createRow(key, value));
      }

      return [...merged.values()];
    });

    setImportOpen(false);
    setImportContent("");
    toast.success(
      t("servers:startupConfig.import.toasts.imported", {
        count: parsed.length,
      }),
    );
  };

  const readFile = async (file: File) => {
    try {
      setImportContent(await file.text());
    } catch {
      toast.error(t("servers:startupConfig.import.toasts.readFailed"));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("servers:startupConfig.loading")}
        </CardContent>
      </Card>
    );
  }

  if (!payload || (!payload.supported && !payload.environment_supported)) {
    return null;
  }

  return (
    <>
      <UnsavedChangesGuard when={commandChanged || environmentChanged} />

      {payload.supported ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                {t("servers:startupConfig.command.title")}
                {payload.customized ? (
                  <Badge variant="secondary">
                    {t("servers:startupConfig.command.customBadge")}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {t("servers:startupConfig.command.description")}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              className="min-h-24 font-mono text-xs"
              disabled={!canEdit}
              onChange={(event) => setCommand(event.target.value)}
              spellCheck={false}
              value={command}
            />
            <p className="text-xs text-muted-foreground">
              {t("servers:startupConfig.command.defaultLabel")}
            </p>
            <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
              {payload.default_command}
            </code>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button
              disabled={!canEdit || command === payload.default_command}
              onClick={() => setCommand(payload.default_command)}
              variant="outline"
            >
              <RotateCcw className="size-4" />
              {t("servers:startupConfig.command.resetButton")}
            </Button>
            <Button
              disabled={!canEdit || !commandChanged}
              loading={isSavingCommand}
              onClick={saveCommand}
            >
              <Save className="size-4" />
              {t("common:actions.save")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {payload.environment_supported ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>
                {t("servers:startupConfig.environment.title")}
              </CardTitle>
              <CardDescription>
                {t("servers:startupConfig.environment.description")}
              </CardDescription>
            </div>
            <Button
              disabled={!canEdit}
              onClick={() => setImportOpen(true)}
              variant="outline"
            >
              <Upload className="size-4" />
              {t("servers:startupConfig.import.button")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                {t("servers:startupConfig.environment.empty")}
              </p>
            ) : (
              rows.map((row) => (
                <div className="space-y-1" key={row.id}>
                  <div className="flex items-start gap-2">
                    <Input
                      aria-invalid={Boolean(rowErrors[row.id])}
                      className="font-mono text-xs sm:max-w-64"
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateRow(row.id, { key: event.target.value })
                      }
                      placeholder={t(
                        "servers:startupConfig.environment.namePlaceholder",
                      )}
                      spellCheck={false}
                      value={row.key}
                    />
                    <Input
                      className="font-mono text-xs"
                      disabled={!canEdit}
                      onChange={(event) =>
                        updateRow(row.id, { value: event.target.value })
                      }
                      placeholder={t(
                        "servers:startupConfig.environment.valuePlaceholder",
                      )}
                      spellCheck={false}
                      value={row.value}
                    />
                    <Button
                      aria-label={t("common:actions.delete")}
                      disabled={!canEdit}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((entry) => entry.id !== row.id),
                        )
                      }
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {rowErrors[row.id] ? (
                    <p className="text-xs text-destructive">
                      {rowErrors[row.id]}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
          <CardFooter className="justify-between gap-2">
            <Button
              disabled={!canEdit || rows.length >= MAX_ENVIRONMENT_VARIABLES}
              onClick={() => setRows((current) => [...current, createRow()])}
              variant="outline"
            >
              <Plus className="size-4" />
              {t("servers:startupConfig.environment.addButton")}
            </Button>
            <Button
              disabled={!canEdit || !environmentChanged || hasRowErrors}
              loading={isSavingEnvironment}
              onClick={saveEnvironment}
            >
              <Save className="size-4" />
              {t("common:actions.save")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <Dialog onOpenChange={setImportOpen} open={importOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("servers:startupConfig.import.dialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("servers:startupConfig.import.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="env-import-content">
              {t("servers:startupConfig.import.contentLabel")}
            </Label>
            <Textarea
              className="min-h-48 font-mono text-xs"
              id="env-import-content"
              onChange={(event) => setImportContent(event.target.value)}
              placeholder={"DATABASE_URL=postgres://…\nLOG_LEVEL=debug"}
              spellCheck={false}
              value={importContent}
            />
            <input
              accept=".env,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file) {
                  void readFile(file);
                }

                event.target.value = "";
              }}
              ref={fileInputRef}
              type="file"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
            >
              <Upload className="size-4" />
              {t("servers:startupConfig.import.chooseFileButton")}
            </Button>
          </div>
          <DialogFooter>
            <Button
              disabled={importContent.trim().length === 0}
              onClick={() => importVariables(true)}
              variant="outline"
            >
              {t("servers:startupConfig.import.replaceButton")}
            </Button>
            <Button
              disabled={importContent.trim().length === 0}
              onClick={() => importVariables(false)}
            >
              {t("servers:startupConfig.import.mergeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
