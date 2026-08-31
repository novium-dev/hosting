"use client";

import { CheckIcon, ClockIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { useAction } from "@/lib/action-hooks";
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
import { createNodeAction, updateNodeRegistrationAction } from "@/actions/nodes";
import {
  listRegions,
  type BackupStorage,
  type ListNodeRegistrationsResponses,
  type ServerStorage,
} from "@/lib/api";

export type NodeRegistration = ListNodeRegistrationsResponses[200][number];

type StorageType = "directory" | "btrfs";
type BackupType = "archive" | "btrfs";

type StorageEntry = {
  name: string;
  type: StorageType;
  path: string;
};

type BackupEntry = {
  name: string;
  type: BackupType;
  path: string;
};

function newStorageEntry(): StorageEntry {
  return { name: "", type: "directory", path: "" };
}

function newBackupEntry(): BackupEntry {
  return { name: "", type: "archive", path: "" };
}

function storageEntriesOf(
  storages: Record<string, ServerStorage> | undefined,
): StorageEntry[] {
  const entries = Object.entries(storages ?? {}).map(([name, storage]) =>
    typeof storage === "string"
      ? { name, type: "directory" as const, path: "" }
      : { name, type: "btrfs" as const, path: storage.btrfs },
  );

  return entries.length === 0 ? [newStorageEntry()] : entries;
}

function backupEntriesOf(
  backups: Record<string, BackupStorage> | undefined,
): BackupEntry[] {
  return Object.entries(backups ?? {}).map(([name, backup]) =>
    typeof backup === "string"
      ? { name, type: "archive" as const, path: "" }
      : { name, type: "btrfs" as const, path: backup.btrfs },
  );
}

function NodeRegistrationDialog({
  open,
  onOpenChange,
  registration,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registration?: NodeRegistration;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [setupCode, setSetupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState(registration?.name ?? "");
  const [region, setRegion] = useState(registration?.region ?? "");
  const [baseUrl, setBaseUrl] = useState(registration?.base_url ?? "");
  const [defaultHost, setDefaultHost] = useState(
    registration?.default_host ?? "",
  );
  const [sshHost, setSshHost] = useState(registration?.ssh?.host ?? "");
  const [ssh, setSsh] = useState(String(registration?.ssh?.port ?? 2022));
  const [storages, setStorages] = useState<StorageEntry[]>(() =>
    storageEntriesOf(registration?.storages),
  );
  const [backups, setBackups] = useState<BackupEntry[]>(() =>
    backupEntriesOf(registration?.backups),
  );

  const createNodeRegistration = useAction(createNodeAction, {
    onSuccess: (result) => {
      if (result.data?.data) {
        setSetupCode(result.data.data);
        onSaved?.();
      } else {
        toast.error(t("admin-infra:nodes.createDialog.createError"));
      }
    },
    onError: ({ error }) => {
      toast.error(
        error.serverError || t("admin-infra:nodes.createDialog.createError"),
      );
    },
  });

  const updateRegistration = useAction(updateNodeRegistrationAction, {
    onSuccess: () => {
      toast.success(t("admin-infra:nodes.editDialog.updateSuccess"));
      onSaved?.();
      onOpenChange(false);
    },
    onError: ({ error }) => {
      toast.error(
        error.serverError || t("admin-infra:nodes.editDialog.updateError"),
      );
    },
  });

  const { data: regions } = useSWR("admin/regions", async () => {
    const response = await listRegions();
    return response.error ? [] : (response.data ?? []);
  });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (region === "") {
      toast.error(t("admin-infra:nodes.createDialog.selectRegionError"));
      return;
    }

    // An empty SSH host disables SSH/SFTP for the node.
    let sshConfig: { host: string; port: number } | undefined;
    const trimmedSshHost = sshHost.trim();
    if (trimmedSshHost !== "") {
      const parsedSsh = Number(ssh.trim());
      if (!Number.isInteger(parsedSsh) || parsedSsh < 1 || parsedSsh > 65535) {
        toast.error(t("admin-infra:nodes.createDialog.invalidSshPortError"));
        return;
      }
      sshConfig = { host: trimmedSshHost, port: parsedSsh };
    }

    const input = {
      name: name.trim(),
      region,
      baseUrl: baseUrl.trim(),
      defaultHost: defaultHost.trim(),
      ssh: sshConfig,
      storages: storages.map((entry) => ({
        name: entry.name.trim(),
        type: entry.type,
        path: entry.type === "btrfs" ? entry.path.trim() : undefined,
      })),
      backups: backups.map((entry) => ({
        name: entry.name.trim(),
        type: entry.type,
        path: entry.type === "btrfs" ? entry.path.trim() : undefined,
      })),
    };

    if (registration) {
      await updateRegistration.executeAsync({
        ...input,
        code: registration.code,
      });
    } else {
      await createNodeRegistration.executeAsync(input);
    }
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success(t("admin-infra:nodes.createDialog.setupCodeCopied"));
  };

  const updateStorage = (index: number, patch: Partial<StorageEntry>) => {
    setStorages((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  };

  const updateBackup = (index: number, patch: Partial<BackupEntry>) => {
    setBackups((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {setupCode ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {t("admin-infra:nodes.createDialog.setupCodeTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("admin-infra:nodes.createDialog.setupCodeDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border bg-muted/40 p-3">
              <code className="block break-all font-mono text-sm">
                {setupCode}
              </code>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleCopy(setupCode)}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {t("admin-infra:nodes.createDialog.copyCodeButton")}
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t("admin-infra:shared.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <DialogHeader>
              <DialogTitle>
                {registration
                  ? t("admin-infra:nodes.editDialog.title")
                  : t("admin-infra:nodes.createDialog.title")}
              </DialogTitle>
              <DialogDescription>
                {registration
                  ? t("admin-infra:nodes.editDialog.description")
                  : t("admin-infra:nodes.createDialog.description")}
              </DialogDescription>
            </DialogHeader>

            {registration ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {t("admin-infra:nodes.createDialog.setupCodeTitle")}
                  </p>
                  <code className="block break-all font-mono text-sm">
                    {registration.code}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy(registration.code)}
                >
                  {copied ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  {t("admin-infra:nodes.createDialog.copyCodeButton")}
                </Button>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="node-name">{t("common:labels.name")}</Label>
                <Input
                  id="node-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="my-node"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-region">{t("common:labels.region")}</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger id="node-region" className="w-full">
                    <SelectValue
                      placeholder={t(
                        "admin-infra:shared.selectRegionPlaceholder",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(regions ?? []).map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.display}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {regions?.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("admin-infra:nodes.createDialog.noRegionsHint")}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-base-url">
                  {t("admin-infra:nodes.createDialog.baseUrlLabel")}
                </Label>
                <Input
                  id="node-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://node.example.com"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="node-default-host">
                  {t("admin-infra:nodes.shared.defaultHost")}
                </Label>
                <Input
                  id="node-default-host"
                  value={defaultHost}
                  onChange={(event) => setDefaultHost(event.target.value)}
                  placeholder="node.example.com"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin-infra:nodes.createDialog.defaultHostHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-ssh-host">
                  {t("admin-infra:nodes.createDialog.sshHostLabel")}
                </Label>
                <Input
                  id="node-ssh-host"
                  value={sshHost}
                  onChange={(event) => setSshHost(event.target.value)}
                  placeholder="node.example.com"
                />
                <p className="text-xs text-muted-foreground">
                  {t("admin-infra:nodes.createDialog.sshHostHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-ssh">
                  {t("admin-infra:nodes.createDialog.sshPortLabel")}
                </Label>
                <Input
                  id="node-ssh"
                  type="number"
                  min={1}
                  max={65535}
                  value={ssh}
                  onChange={(event) => setSsh(event.target.value)}
                  placeholder="2022"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {t("admin-infra:nodes.createDialog.storagesTitle")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("admin-infra:nodes.createDialog.storagesHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setStorages((prev) => [...prev, newStorageEntry()])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  {t("admin-infra:nodes.createDialog.addStorageButton")}
                </Button>
              </div>

              {storages.map((entry, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_10rem_auto]"
                >
                  <div className="space-y-2">
                    <Label>{t("common:labels.name")}</Label>
                    <Input
                      value={entry.name}
                      onChange={(event) =>
                        updateStorage(index, { name: event.target.value })
                      }
                      placeholder="local"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("common:labels.type")}</Label>
                    <Select
                      value={entry.type}
                      onValueChange={(value) =>
                        updateStorage(index, { type: value as StorageType })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="directory">
                          {t(
                            "admin-infra:nodes.createDialog.storageTypeDirectory",
                          )}
                        </SelectItem>
                        <SelectItem value="btrfs">
                          {t("admin-infra:nodes.createDialog.storageTypeBtrfs")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={storages.length <= 1}
                      onClick={() =>
                        setStorages((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                  {entry.type === "btrfs" && (
                    <div className="space-y-2 sm:col-span-3">
                      <Label>
                        {t("admin-infra:nodes.createDialog.btrfsPathLabel")}
                      </Label>
                      <Input
                        value={entry.path}
                        onChange={(event) =>
                          updateStorage(index, { path: event.target.value })
                        }
                        placeholder="/mnt/btrfs/storage"
                        required
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">
                    {t("common:nav.backups")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("admin-infra:nodes.createDialog.backupsHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBackups((prev) => [...prev, newBackupEntry()])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  {t("admin-infra:nodes.createDialog.addBackupButton")}
                </Button>
              </div>

              {backups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("admin-infra:nodes.createDialog.noBackupsHint")}
                </p>
              ) : (
                backups.map((entry, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_10rem_auto]"
                  >
                    <div className="space-y-2">
                      <Label>{t("common:labels.name")}</Label>
                      <Input
                        value={entry.name}
                        onChange={(event) =>
                          updateBackup(index, { name: event.target.value })
                        }
                        placeholder="backups"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("common:labels.type")}</Label>
                      <Select
                        value={entry.type}
                        onValueChange={(value) =>
                          updateBackup(index, { type: value as BackupType })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="archive">
                            {t("common:resources.archive")}
                          </SelectItem>
                          <SelectItem value="btrfs">
                            {t(
                              "admin-infra:nodes.createDialog.storageTypeBtrfs",
                            )}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setBackups((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                    {entry.type === "btrfs" && (
                      <div className="space-y-2 sm:col-span-3">
                        <Label>
                          {t("admin-infra:nodes.createDialog.btrfsPathLabel")}
                        </Label>
                        <Input
                          value={entry.path}
                          onChange={(event) =>
                            updateBackup(index, { path: event.target.value })
                          }
                          placeholder="/mnt/btrfs/backups"
                          required
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                type="submit"
                loading={
                  registration
                    ? updateRegistration.isPending
                    : createNodeRegistration.isPending
                }
              >
                {registration
                  ? t("common:actions.save")
                  : t("admin-infra:nodes.createDialog.title")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreateNodeDialog({
  canCreate,
  onCreated,
}: {
  canCreate: boolean;
  onCreated?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!canCreate) {
    return null;
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        {t("admin-infra:nodes.createDialog.title")}
      </Button>

      <NodeRegistrationDialog
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={setOpen}
        onSaved={onCreated}
      />
    </>
  );
}

export function EditNodeRegistrationDialog({
  registration,
  canManage,
  onSaved,
}: {
  registration: NodeRegistration;
  canManage: boolean;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!canManage) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <ClockIcon data-icon="inline-start" />
        {t("admin-infra:nodes.editDialog.trigger")}
      </Button>

      <NodeRegistrationDialog
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={setOpen}
        registration={registration}
        onSaved={onSaved}
      />
    </>
  );
}
