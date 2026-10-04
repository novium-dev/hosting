"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  FileCode,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

export function StartupConfiguration({
  canEdit,
  serverId,
}: StartupConfigurationProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [payload, setPayload] = useState<StartupPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [isSavingEnvironment, setIsSavingEnvironment] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importContent, setImportContent] = useState("");
  const [fileEnabled, setFileEnabled] = useState(false);
  const [filePath, setFilePath] = useState(".env");

  const load = useCallback(async () => {
    const response = await serverStartup({ path: { server_id: serverId } });

    if (response.error || !response.data) {
      throw new Error(t("servers:startupConfig.toasts.loadFailed"));
    }

    setPayload(response.data);

    return response.data;
  }, [serverId, t]);

  useEffect(() => {
    let mounted = true;

    const initial = async () => {
      setIsLoading(true);

      try {
        await load();
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

    void initial();

    return () => {
      mounted = false;
    };
  }, [load, t]);

  const reserved = useMemo(
    () => new Set(payload?.environment.reserved ?? []),
    [payload],
  );

  const filledRows = useMemo(
    () =>
      rows.filter((row) => row.key.trim().length > 0 || row.value.length > 0),
    [rows],
  );

  const rowErrors = useMemo(() => {
    const seen = new Set<string>();
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

      if (seen.has(key)) {
        errors[row.id] = t("servers:startupConfig.environment.errors.duplicate");
        continue;
      }

      seen.add(key);
    }

    return errors;
  }, [filledRows, reserved, t]);

  const hasRowErrors = Object.keys(rowErrors).length > 0;

  const filePathError = useMemo(() => {
    if (!fileEnabled) {
      return null;
    }

    const trimmed = filePath.trim();

    if (trimmed.length === 0) {
      return t("servers:startupConfig.envFile.errors.empty");
    }

    const segments = trimmed.split("/");
    const valid = segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        /^[A-Za-z0-9._-]+$/.test(segment),
    );

    return valid ? null : t("servers:startupConfig.envFile.errors.path");
  }, [fileEnabled, filePath, t]);

  const openEnvironmentDialog = () => {
    setRows(toRows(payload?.environment.variables ?? {}));
    setFileEnabled(payload?.environment.file_enabled ?? false);
    setFilePath(payload?.environment.file_path ?? ".env");
    setImportOpen(false);
    setImportContent("");
    setEnvironmentOpen(true);
  };

  const saveEnvironment = async () => {
    if (!payload) {
      return;
    }

    if (hasRowErrors || filePathError) {
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
        body: {
          environment,
          env_file_enabled: fileEnabled,
          env_file_path: filePath.trim(),
        },
      });

      if (response.error) {
        throw new Error(t("servers:startupConfig.toasts.saveFailed"));
      }

      await load();
      setEnvironmentOpen(false);
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

        merged.set(
          key,
          existing ? { ...existing, value } : createRow(key, value),
        );
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

  if (!payload?.environment.supported) {
    return null;
  }

  const environmentEntries = Object.entries(payload.environment.variables).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  return (
    <>
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>{t("servers:startupConfig.warning.title")}</AlertTitle>
        <AlertDescription>
          {t("servers:startupConfig.warning.description")}
        </AlertDescription>
      </Alert>

      <Card>
          <CardHeader>
            <CardTitle>
              {t("servers:startupConfig.environment.title")}
            </CardTitle>
            <CardDescription>
              {t("servers:startupConfig.environment.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border px-3 py-2">
              <FileCode className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {payload.environment.file_enabled ? (
                  <Trans
                    components={{
                      path: <code className="font-mono text-foreground" />,
                    }}
                    i18nKey="servers:startupConfig.envFile.cardEnabled"
                    values={{ path: payload.environment.file_path }}
                  />
                ) : (
                  t("servers:startupConfig.envFile.cardDisabled")
                )}
              </p>
            </div>
            {environmentEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("servers:startupConfig.environment.empty")}
              </p>
            ) : (
              <dl className="divide-y rounded-md border">
                {environmentEntries.map(([key, value]) => (
                  <div
                    className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:gap-4"
                    key={key}
                  >
                    <dt className="font-mono text-xs font-medium sm:w-64 sm:shrink-0">
                      {key}
                    </dt>
                    <dd className="font-mono text-xs break-all text-muted-foreground">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              disabled={!canEdit}
              onClick={openEnvironmentDialog}
              variant="outline"
            >
              <Pencil className="size-4" />
              {t("common:actions.edit")}
            </Button>
          </CardFooter>
      </Card>

      <Dialog onOpenChange={setEnvironmentOpen} open={environmentOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("servers:startupConfig.environment.dialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("servers:startupConfig.warning.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="env-file-enabled">
                  {t("servers:startupConfig.envFile.toggleLabel")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("servers:startupConfig.envFile.toggleDescription")}
                </p>
              </div>
              <Switch
                checked={fileEnabled}
                id="env-file-enabled"
                onCheckedChange={setFileEnabled}
              />
            </div>
            {fileEnabled ? (
              <div className="space-y-1">
                <Label htmlFor="env-file-path">
                  {t("servers:startupConfig.envFile.pathLabel")}
                </Label>
                <Input
                  aria-invalid={Boolean(filePathError)}
                  className="font-mono text-xs"
                  id="env-file-path"
                  onChange={(event) => setFilePath(event.target.value)}
                  placeholder=".env"
                  spellCheck={false}
                  value={filePath}
                />
                {filePathError ? (
                  <p className="text-xs text-destructive">{filePathError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("servers:startupConfig.envFile.pathHelp")}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            {importOpen ? (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="env-import-content">
                  {t("servers:startupConfig.import.contentLabel")}
                </Label>
                <Textarea
                  className="min-h-32 font-mono text-xs"
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
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                  >
                    <Upload className="size-4" />
                    {t("servers:startupConfig.import.chooseFileButton")}
                  </Button>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      onClick={() => setImportOpen(false)}
                      variant="ghost"
                    >
                      {t("common:actions.cancel")}
                    </Button>
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
                  </div>
                </div>
              </div>
            ) : (
              <Button onClick={() => setImportOpen(true)} variant="outline">
                <Upload className="size-4" />
                {t("servers:startupConfig.import.button")}
              </Button>
            )}

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
                      className="font-mono text-xs sm:max-w-56"
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

            <Button
              disabled={rows.length >= MAX_ENVIRONMENT_VARIABLES}
              onClick={() => setRows((current) => [...current, createRow()])}
              variant="outline"
            >
              <Plus className="size-4" />
              {t("servers:startupConfig.environment.addButton")}
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={() => setEnvironmentOpen(false)} variant="ghost">
              {t("common:actions.cancel")}
            </Button>
            <Button
              disabled={hasRowErrors || Boolean(filePathError)}
              loading={isSavingEnvironment}
              onClick={saveEnvironment}
            >
              <Save className="size-4" />
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
