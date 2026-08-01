"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/lib/navigation";
import { useSettingsDialog } from "@/hooks/use-settings-dialog";
import { Copy, ExternalLink, FolderOpen, Loader2, Network } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { serverInfo, updateServer } from "@/lib/api";

type ServerSettingsProps = {
  serverId: string;
  username: string;
  nodeHostname: string;
  sshPort: number | null;
};

export function ServerSettings({
  serverId,
  username,
  nodeHostname,
  sshPort,
}: ServerSettingsProps) {
  const router = useRouter();
  const { open: openSettings } = useSettingsDialog();
  const [name, setName] = useState("");
  const [initialName, setInitialName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sftpUrl, setSftpUrl] = useState("");

  const refresh = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await serverInfo({
        path: { server_id: serverId },
      });

      if (response.error || !response.data) {
        throw new Error("Failed to load server settings");
      }

      const nextName = response.data.name;
      setName(nextName);
      setInitialName(nextName);
    } catch {
      toast.error("Failed to load server settings");
    } finally {
      setIsLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const host = nodeHostname || "Unknown";
    const portPart = sshPort ? `:${sshPort}` : "";

    setSftpUrl(
      `sftp://${encodeURIComponent(username)}@${host}${portPart}/${encodeURIComponent(serverId)}`,
    );
  }, [serverId, username, nodeHostname, sshPort]);

  const canSave =
    name.trim().length > 0 && name.trim() !== initialName && !isSaving;

  const isNameDirty = name.trim() !== initialName;

  const onSave = async () => {
    const nextName = name.trim();
    if (!nextName || nextName === initialName) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await updateServer({
        path: { server_id: serverId },
        body: {
          name: nextName,
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? "Failed to update server name",
        );
        return;
      }

      toast.success("Server name updated");
      setInitialName(nextName);
      setName(nextName);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(username);
      toast.success("SFTP username copied");
    } catch {
      toast.error("Failed to copy SFTP username");
    }
  };

  const copySftpUrl = async () => {
    try {
      await navigator.clipboard.writeText(sftpUrl);
      toast.success("SFTP URL copied");
    } catch {
      toast.error("Failed to copy SFTP URL");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Update your server display name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading settings...
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Server name</p>
                  {isNameDirty ? (
                    <span className="text-xs font-medium text-amber-600">
                      Edited
                    </span>
                  ) : null}
                </div>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Server name"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    void onSave();
                  }}
                  loading={isSaving}
                  disabled={!canSave}
                >
                  Save name
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void refresh();
                  }}
                  disabled={isSaving}
                >
                  Reset
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {sshPort != null && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-5 text-muted-foreground" />
            SFTP Access
          </CardTitle>
          <CardDescription>
            Use your daemon password for SFTP password auth, or configure SSH
            public key auth from your profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Username</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={username} className="font-mono" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void copyUsername();
                }}
              >
                <Copy className="size-4" />
                Copy
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Open with SFTP</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={sftpUrl} className="font-mono" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void copySftpUrl();
                }}
                disabled={!sftpUrl}
              >
                <Copy className="size-4" />
                Copy
              </Button>
              <Button asChild variant="outline" className="shrink-0">
                <a href={sftpUrl}>
                  <FolderOpen className="size-4" />
                  Open
                </a>
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border bg-background/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Your SFTP password is the daemon password shown in your settings.
              You can also add SSH public keys there.
            </p>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => openSettings("daemon")}
            >
              <ExternalLink className="size-4" />
              Daemon Auth
            </Button>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
