"use client";

import {
  addSshKey,
  daemonPassword,
  deleteSshKey,
  listSshKeys,
  rerollDaemonPassword,
} from "@/lib/api";
import type { ListSshKeysResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

type ApiError = {
  error?: {
    msg?: string;
  };
};

const maskedValue = "************************";

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "error" in error) {
    const apiError = error as ApiError;
    return apiError.error?.msg ?? fallback;
  }

  return fallback;
}

function maskSshKey(publicKey: string) {
  const [type] = publicKey.trim().split(/\s+/);
  return `${type || "ssh-key"} ${maskedValue}`;
}

async function fetchSshKeys() {
  const response = await listSshKeys();
  if (response.error) {
    throw new Error(errorMessage(response.error, "Failed to load SSH keys"));
  }

  return response.data ?? [];
}

export default function ProfileAuthCard() {
  const {
    data: sshKeys = [],
    error: sshKeysError,
    isLoading: sshKeysLoading,
    mutate,
  } = useSWR<ListSshKeysResponse>("profile/ssh-keys", fetchSshKeys, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const [showSshKeys, setShowSshKeys] = useState(false);
  const [showDaemonPassword, setShowDaemonPassword] = useState(false);
  const [daemonPasswordValue, setDaemonPasswordValue] = useState<string | null>(
    null,
  );
  const [daemonLoading, setDaemonLoading] = useState(false);
  const [rerollLoading, setRerollLoading] = useState(false);
  const [deletingKeyId, setDeletingKeyId] = useState<number | null>(null);
  const [addingKey, setAddingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const loadDaemonPassword = async () => {
    setDaemonLoading(true);
    const response = await daemonPassword().finally(() => {
      setDaemonLoading(false);
    });

    if (response.error || !response.data) {
      toast.error(
        errorMessage(response.error, "Failed to load daemon password"),
      );
      return false;
    }

    setDaemonPasswordValue(response.data);
    return true;
  };

  const toggleDaemonPassword = async () => {
    if (showDaemonPassword) {
      setShowDaemonPassword(false);
      return;
    }

    if (!daemonPasswordValue) {
      const loaded = await loadDaemonPassword();
      if (!loaded) return;
    }

    setShowDaemonPassword(true);
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  const handleRerollDaemonPassword = async () => {
    const confirmed = window.confirm(
      "Regenerate the daemon password? Existing password auth connections will need the new password.",
    );
    if (!confirmed) return;

    setRerollLoading(true);
    const response = await rerollDaemonPassword().finally(() => {
      setRerollLoading(false);
    });

    if (response.error || !response.data) {
      toast.error(
        errorMessage(response.error, "Failed to regenerate daemon password"),
      );
      return;
    }

    setDaemonPasswordValue(response.data);
    setShowDaemonPassword(true);
    toast.success("Daemon password regenerated");
  };

  const handleAddSshKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = keyName.trim();
    const key = publicKey.trim();
    if (!name || !key) {
      toast.error("Name and public key are required");
      return;
    }

    setAddingKey(true);
    const response = await addSshKey({
      body: {
        name,
        public_key: key,
      },
    }).finally(() => {
      setAddingKey(false);
    });

    if (response.error) {
      toast.error(errorMessage(response.error, "Failed to add SSH key"));
      return;
    }

    setKeyName("");
    setPublicKey("");
    await mutate();
    toast.success("SSH key added");
  };

  const handleDeleteSshKey = async (keyId: number) => {
    setDeletingKeyId(keyId);
    const response = await deleteSshKey({
      path: {
        key_id: keyId,
      },
    }).finally(() => {
      setDeletingKeyId(null);
    });

    if (response.error) {
      toast.error(errorMessage(response.error, "Failed to delete SSH key"));
      return;
    }

    await mutate();
    toast.success("SSH key deleted");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-muted-foreground" />
          Daemon Auth
        </CardTitle>
        <CardDescription>
          Use the daemon password for SFTP password auth, or add SSH public keys
          for SFTP SSH access.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6 overflow-hidden">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="daemon-password">Daemon password</Label>
              <Input
                id="daemon-password"
                readOnly
                type={showDaemonPassword ? "text" : "password"}
                value={
                  showDaemonPassword && daemonPasswordValue
                    ? daemonPasswordValue
                    : maskedValue
                }
                className="font-mono"
              />
            </div>
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={toggleDaemonPassword}
                    loading={daemonLoading}
                    aria-label={
                      showDaemonPassword
                        ? "Hide daemon password"
                        : "Reveal daemon password"
                    }
                  >
                    {showDaemonPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showDaemonPassword ? "Hide password" : "Reveal password"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!showDaemonPassword || !daemonPasswordValue}
                    onClick={() => {
                      if (daemonPasswordValue) {
                        void handleCopy(daemonPasswordValue, "Daemon password");
                      }
                    }}
                    aria-label="Copy daemon password"
                  >
                    <Copy className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy password</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="outline"
                onClick={handleRerollDaemonPassword}
                loading={rerollLoading}
              >
                <RefreshCw className="size-4" />
                Regenerate
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">SSH public keys</h3>
              <p className="text-sm text-muted-foreground">
                Public keys are hidden until revealed.
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSshKeys((value) => !value)}
                  aria-label={
                    showSshKeys
                      ? "Hide SSH public keys"
                      : "Reveal SSH public keys"
                  }
                >
                  {showSshKeys ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showSshKeys ? "Hide keys" : "Reveal keys"}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="space-y-3">
            {sshKeysLoading ? (
              <div className="rounded-lg border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
                Loading SSH keys...
              </div>
            ) : sshKeysError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Failed to load SSH keys.
              </div>
            ) : sshKeys.length === 0 ? (
              <div className="rounded-lg border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
                No SSH keys added.
              </div>
            ) : (
              sshKeys.map((sshKey) => (
                <div
                  key={sshKey.id}
                  className="flex flex-col gap-3 rounded-lg border bg-background/50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium">{sshKey.name}</div>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {showSshKeys
                        ? sshKey.public_key
                        : maskSshKey(sshKey.public_key)}
                    </p>
                  </div>
                  <div className="flex gap-2 sm:pt-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={!showSshKeys}
                          onClick={() =>
                            void handleCopy(sshKey.public_key, "SSH public key")
                          }
                          aria-label={`Copy ${sshKey.name}`}
                        >
                          <Copy className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy key</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          loading={deletingKeyId === sshKey.id}
                          onClick={() => void handleDeleteSshKey(sshKey.id)}
                          aria-label={`Delete ${sshKey.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete key</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            className="grid min-w-0 gap-3 overflow-hidden rounded-lg border p-4"
            onSubmit={handleAddSshKey}
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="ssh-key-name">Key name</Label>
                <Input
                  id="ssh-key-name"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  placeholder="Workstation"
                  autoComplete="off"
                  className="min-w-0"
                />
              </div>
              <Button
                type="submit"
                className="self-end"
                loading={addingKey}
                disabled={!keyName.trim() || !publicKey.trim()}
              >
                Add Key
              </Button>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="ssh-public-key">Public key</Label>
              <Textarea
                id="ssh-public-key"
                value={publicKey}
                onChange={(event) => setPublicKey(event.target.value)}
                placeholder="ssh-ed25519 AAAA..."
                wrap="soft"
                className="min-h-24 min-w-0 max-w-full resize-y overflow-x-hidden break-all font-mono"
              />
            </div>
          </form>
        </section>
      </CardContent>
    </Card>
  );
}
