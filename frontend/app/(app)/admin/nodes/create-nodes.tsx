"use client";

import { CheckIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { createNodeAction } from "@/actions/nodes";
import { listRegions } from "@/lib/api";

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

export function CreateNodeDialog({ canCreate }: { canCreate: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [setupCode, setSetupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultHost, setDefaultHost] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [ssh, setSsh] = useState("2022");
  const [storages, setStorages] = useState<StorageEntry[]>([newStorageEntry()]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  const createNodeRegistration = useAction(createNodeAction, {
    onSuccess: (result) => {
      if (result.data?.data) {
        setSetupCode(result.data.data);
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

  const { data: regions } = useSWR("admin/regions", async () => {
    const response = await listRegions();
    return response.error ? [] : (response.data ?? []);
  });

  const resetForm = () => {
    setName("");
    setRegion("");
    setBaseUrl("");
    setDefaultHost("");
    setSshHost("");
    setSsh("2022");
    setStorages([newStorageEntry()]);
    setBackups([]);
    setSetupCode(null);
    setCopied(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      resetForm();
    }
  };

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

    await createNodeRegistration.executeAsync({
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
    });
  };

  const handleCopy = async () => {
    if (!setupCode) return;

    await navigator.clipboard.writeText(setupCode);
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

  if (!canCreate) {
    return null;
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        {t("admin-infra:nodes.createDialog.title")}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
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
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {copied ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  {t("admin-infra:nodes.createDialog.copyCodeButton")}
                </Button>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  {t("admin-infra:shared.done")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <DialogHeader>
                <DialogTitle>
                  {t("admin-infra:nodes.createDialog.title")}
                </DialogTitle>
                <DialogDescription>
                  {t("admin-infra:nodes.createDialog.description")}
                </DialogDescription>
              </DialogHeader>

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
                          setStorages((prev) =>
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
                      {t("admin-infra:nodes.createDialog.backupsTitle")}
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
                              {t(
                                "admin-infra:nodes.createDialog.backupTypeArchive",
                              )}
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
                  onClick={() => handleOpenChange(false)}
                >
                  {t("common:actions.cancel")}
                </Button>
                <Button type="submit" loading={createNodeRegistration.isPending}>
                  {t("admin-infra:nodes.createDialog.title")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
