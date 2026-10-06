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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useSWR from "swr";
import { apiErrorMessage } from "@/lib/api-error";

const maskedValue = "************************";

function maskSshKey(publicKey: string) {
  const [type] = publicKey.trim().split(/\s+/);
  return `${type || "ssh-key"} ${maskedValue}`;
}

async function fetchSshKeys(fallback: string) {
  const response = await listSshKeys();
  if (response.error) {
    throw new Error(apiErrorMessage(response.error, fallback));
  }

  return response.data ?? [];
}

export function DaemonAuthSection() {
  const { t } = useTranslation();
  const {
    data: sshKeys = [],
    error: sshKeysError,
    isLoading: sshKeysLoading,
    mutate,
  } = useSWR<ListSshKeysResponse>(
    "profile/ssh-keys",
    () => fetchSshKeys(t("settings:daemonAuth.sshKeysLoadErrorToast")),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  );
  const [showSshKeys, setShowSshKeys] = useState(false);
  const [showDaemonPassword, setShowDaemonPassword] = useState(false);
  const [daemonPasswordValue, setDaemonPasswordValue] = useState<string | null>(
    null,
  );
  const [daemonLoading, setDaemonLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [rerollLoading, setRerollLoading] = useState(false);
  const [deletingKeyId, setDeletingKeyId] = useState<number | null>(null);
  const [addingKey, setAddingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const loadDaemonPassword = async (
    setLoading: (loading: boolean) => void,
  ) => {
    if (daemonPasswordValue) {
      return daemonPasswordValue;
    }

    setLoading(true);
    const response = await daemonPassword().finally(() => {
      setLoading(false);
    });

    if (response.error || !response.data) {
      toast.error(
        apiErrorMessage(response.error, t("settings:daemonAuth.loadError")),
      );
      return null;
    }

    setDaemonPasswordValue(response.data);
    return response.data;
  };

  const toggleDaemonPassword = async () => {
    if (showDaemonPassword) {
      setShowDaemonPassword(false);
      return;
    }

    const password = await loadDaemonPassword(setDaemonLoading);
    if (!password) return;

    setShowDaemonPassword(true);
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("settings:daemonAuth.copiedToast", { label }));
    } catch {
      toast.error(t("settings:daemonAuth.copyFailedToast", { label }));
    }
  };

  const handleCopyDaemonPassword = async () => {
    const password = await loadDaemonPassword(setCopyLoading);
    if (!password) return;

    await handleCopy(password, t("settings:daemonAuth.passwordLabel"));
  };

  const handleRerollDaemonPassword = async () => {
    const confirmed = window.confirm(
      t("settings:daemonAuth.regenerateConfirm"),
    );
    if (!confirmed) return;

    setRerollLoading(true);
    const response = await rerollDaemonPassword().finally(() => {
      setRerollLoading(false);
    });

    if (response.error || !response.data) {
      toast.error(
        apiErrorMessage(response.error, t("settings:daemonAuth.regenerateError")),
      );
      return;
    }

    setDaemonPasswordValue(response.data);
    setShowDaemonPassword(true);
    toast.success(t("settings:daemonAuth.regenerateSuccess"));
  };

  const handleAddSshKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = keyName.trim();
    const key = publicKey.trim();
    if (!name || !key) {
      toast.error(t("settings:daemonAuth.nameAndKeyRequired"));
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
      toast.error(
        apiErrorMessage(response.error, t("settings:daemonAuth.addKeyError")),
      );
      return;
    }

    setKeyName("");
    setPublicKey("");
    await mutate();
    toast.success(t("settings:daemonAuth.keyAdded"));
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
      toast.error(
        apiErrorMessage(response.error, t("settings:daemonAuth.deleteKeyError")),
      );
      return;
    }

    await mutate();
    toast.success(t("settings:daemonAuth.keyDeleted"));
  };

  return (
    <div className="min-w-0 space-y-6 overflow-hidden">
      <section className="space-y-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-medium">
            {t("settings:daemonAuth.passwordLabel")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("settings:daemonAuth.passwordDescription")}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="daemon-password" className="sr-only">
              {t("settings:daemonAuth.passwordLabel")}
            </Label>
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
                      ? t("settings:daemonAuth.hidePassword")
                      : t("settings:daemonAuth.revealPassword")
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
                {showDaemonPassword
                  ? t("settings:daemonAuth.hidePasswordTooltip")
                  : t("settings:daemonAuth.revealPasswordTooltip")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void handleCopyDaemonPassword();
                  }}
                  loading={copyLoading}
                  aria-label={t("settings:daemonAuth.copyPasswordAriaLabel")}
                >
                  <Copy className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("settings:daemonAuth.copyPasswordTooltip")}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              onClick={handleRerollDaemonPassword}
              loading={rerollLoading}
            >
              <RefreshCw className="size-4" />
              {t("settings:daemonAuth.regenerate")}
            </Button>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium">
              {t("settings:daemonAuth.sshKeysTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("settings:daemonAuth.sshKeysDescription")}
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
                    ? t("settings:daemonAuth.hideSshKeys")
                    : t("settings:daemonAuth.revealSshKeys")
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
              {showSshKeys
                ? t("settings:daemonAuth.hideKeysTooltip")
                : t("settings:daemonAuth.revealKeysTooltip")}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="space-y-3">
          {sshKeysLoading ? (
            <div className="rounded-lg border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
              {t("settings:daemonAuth.loadingSshKeys")}
            </div>
          ) : sshKeysError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {t("settings:daemonAuth.sshKeysLoadError")}
            </div>
          ) : sshKeys.length === 0 ? (
            <div className="rounded-lg border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
              {t("settings:daemonAuth.noSshKeys")}
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
                          void handleCopy(
                            sshKey.public_key,
                            t("settings:daemonAuth.sshKeyLabel"),
                          )
                        }
                        aria-label={t("settings:daemonAuth.copyKeyAriaLabel", {
                          name: sshKey.name,
                        })}
                      >
                        <Copy className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("settings:daemonAuth.copyKeyTooltip")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        loading={deletingKeyId === sshKey.id}
                        onClick={() => void handleDeleteSshKey(sshKey.id)}
                        aria-label={t(
                          "settings:daemonAuth.deleteKeyAriaLabel",
                          { name: sshKey.name },
                        )}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("settings:daemonAuth.deleteKeyTooltip")}
                    </TooltipContent>
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
              <Label htmlFor="ssh-key-name">
                {t("settings:daemonAuth.keyNameLabel")}
              </Label>
              <Input
                id="ssh-key-name"
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder={t("settings:daemonAuth.keyNamePlaceholder")}
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
              {t("settings:daemonAuth.addKey")}
            </Button>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="ssh-public-key">
              {t("settings:daemonAuth.publicKeyLabel")}
            </Label>
            <Textarea
              id="ssh-public-key"
              value={publicKey}
              onChange={(event) => setPublicKey(event.target.value)}
              placeholder={t("settings:daemonAuth.publicKeyPlaceholder")}
              wrap="soft"
              className="min-h-24 min-w-0 max-w-full resize-y overflow-x-hidden break-all font-mono"
            />
          </div>
        </form>
      </section>
    </div>
  );
}
