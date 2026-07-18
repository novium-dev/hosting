"use client";

import { CheckIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { createNodeAction } from "../../../../actions/nodes";

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
  const [open, setOpen] = useState(false);
  const [setupCode, setSetupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [ssh, setSsh] = useState("22");
  const [storages, setStorages] = useState<StorageEntry[]>([newStorageEntry()]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  const createNodeRegistration = useAction(createNodeAction, {
    onSuccess: (result) => {
      if (result.data?.data) {
        setSetupCode(result.data.data);
      } else {
        toast.error("Failed to create node");
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || "Failed to create node");
    },
  });

  const resetForm = () => {
    setName("");
    setBaseUrl("");
    setSsh("22");
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

    const parsedSsh = Number(ssh);
    if (!Number.isInteger(parsedSsh) || parsedSsh < 1 || parsedSsh > 65535) {
      toast.error("SSH port must be a valid port number");
      return;
    }

    await createNodeRegistration.executeAsync({
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      ssh: parsedSsh,
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
    toast.success("Setup code copied");
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
        Create Node
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {setupCode ? (
            <>
              <DialogHeader>
                <DialogTitle>Node setup code</DialogTitle>
                <DialogDescription>
                  Use this code when registering the new node. Keep it private.
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
                  Copy code
                </Button>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <DialogHeader>
                <DialogTitle>Create Node</DialogTitle>
                <DialogDescription>
                  Configure the new node and generate its setup code.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="node-name">Name</Label>
                  <Input
                    id="node-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="my-node"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="node-ssh">SSH Port</Label>
                  <Input
                    id="node-ssh"
                    type="number"
                    min={1}
                    max={65535}
                    value={ssh}
                    onChange={(event) => setSsh(event.target.value)}
                    placeholder="22"
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="node-base-url">Base URL</Label>
                  <Input
                    id="node-base-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://node.example.com"
                    required
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Storages</h2>
                    <p className="text-sm text-muted-foreground">
                      At least one server storage is required.
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
                    Add storage
                  </Button>
                </div>

                {storages.map((entry, index) => (
                  <div
                    key={index}
                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_10rem_auto]"
                  >
                    <div className="space-y-2">
                      <Label>Name</Label>
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
                      <Label>Type</Label>
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
                          <SelectItem value="directory">Directory</SelectItem>
                          <SelectItem value="btrfs">Btrfs</SelectItem>
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
                        <Label>Btrfs path</Label>
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
                    <h2 className="text-base font-semibold">Backups</h2>
                    <p className="text-sm text-muted-foreground">
                      Optional backup storages.
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
                    Add backup
                  </Button>
                </div>

                {backups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No backup storages configured.
                  </p>
                ) : (
                  backups.map((entry, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_10rem_auto]"
                    >
                      <div className="space-y-2">
                        <Label>Name</Label>
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
                        <Label>Type</Label>
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
                            <SelectItem value="archive">Archive</SelectItem>
                            <SelectItem value="btrfs">Btrfs</SelectItem>
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
                          <Label>Btrfs path</Label>
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
                  Cancel
                </Button>
                <Button type="submit" loading={createNodeRegistration.isPending}>
                  Create Node
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
