import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { Boxes, Download, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  installModpackAction,
  listResourceVersionsAction,
} from "@/actions/mod-browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_LABELS } from "@/lib/mod-browser/types";
import type {
  ResourceLoader,
  ResourceProvider,
  ResourceVersion,
} from "@/lib/mod-browser/types";
import { ProjectIcon, formatDate, versionLabel } from "./shared";

export type ModpackTarget = {
  provider: ResourceProvider;
  project: string;
  title: string;
  loader: ResourceLoader;
  iconUrl?: string | null;
  pageUrl?: string | null;
};

type ModpackInstallDialogProps = {
  serverId: string;
  target: ModpackTarget | null;
  onOpenChange: (open: boolean) => void;
  initialVersionId?: string;
  installedVersion?: string | null;
  backupAvailable: boolean;
  serverStopped: boolean;
  onStarted: () => void;
};

export function ModpackInstallDialog({
  serverId,
  target,
  onOpenChange,
  initialVersionId,
  installedVersion,
  backupAvailable,
  serverStopped,
  onStarted,
}: ModpackInstallDialogProps) {
  const { t } = useTranslation();
  const [versionId, setVersionId] = useState(initialVersionId ?? "");
  const [backup, setBackup] = useState(backupAvailable);
  const [wipe, setWipe] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  const { data: versions = [], isLoading } = useSWR(
    target
      ? ["modpack-install-versions", serverId, target.provider, target.project]
      : null,
    async () => {
      if (!target) return [];
      const result = await listResourceVersionsAction({
        serverId,
        provider: target.provider,
        project: target.project,
        loader: target.loader,
        kind: "modpack",
      });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? [];
    },
  );

  useEffect(() => {
    setBackup(backupAvailable);
  }, [backupAvailable, target]);

  useEffect(() => {
    if (!target) return;
    setVersionId(initialVersionId ?? "");
  }, [target, initialVersionId]);

  useEffect(() => {
    if (versionId || versions.length === 0) return;
    setVersionId(initialVersionId ?? versions[0].id);
  }, [initialVersionId, versionId, versions]);

  const version = versions.find((entry) => entry.id === versionId) ?? null;
  const isCurrent = Boolean(
    installedVersion && version && installedVersion === version.id,
  );

  const start = async () => {
    if (!target || !version) return;

    setIsStarting(true);
    const result = await installModpackAction({
      serverId,
      provider: target.provider,
      project: target.project,
      version: version.id,
      loader: target.loader,
      title: target.title,
      versionNumber: version.version_number,
      iconUrl: target.iconUrl ?? undefined,
      pageUrl: target.pageUrl ?? undefined,
      backup,
      wipe,
    });
    setIsStarting(false);

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      t("servers-management:mods.pack.toasts.started", { title: target.title }),
    );
    onOpenChange(false);
    onStarted();
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-5" />
            {target
              ? t("servers-management:mods.pack.dialog.title", {
                  title: target.title,
                })
              : null}
          </DialogTitle>
          <DialogDescription>
            {t("servers-management:mods.pack.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {target ? (
            <div className="flex items-center gap-3 rounded-md border p-3">
              <ProjectIcon src={target.iconUrl} title={target.title} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{target.title}</span>
                <span className="text-sm text-muted-foreground">
                  {PROVIDER_LABELS[target.provider]}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="modpack-version">
              {t("servers-management:mods.versionLabel")}
            </Label>
            <Select
              items={[
                ...versions.map((entry) => ({
                  value: entry.id,
                  label: versionLabel(entry),
                })),
              ]}
              value={versionId}
              onValueChange={(value) => setVersionId(value ?? "")}
              disabled={isLoading || versions.length === 0}
            >
              <SelectTrigger id="modpack-version" className="w-full">
                <SelectValue
                  placeholder={
                    isLoading
                      ? t("servers-management:mods.loadingVersions")
                      : t("servers-management:mods.noVersions")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {versions.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {versionLabel(entry)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {version ? <VersionMeta version={version} /> : null}
          </div>

          <label className="flex items-start gap-3">
            <Switch
              checked={backup}
              disabled={!backupAvailable}
              onCheckedChange={setBackup}
            />
            <span className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {t("servers-management:mods.pack.dialog.backupLabel")}
              </span>
              <span className="text-sm text-muted-foreground">
                {backupAvailable
                  ? t("servers-management:mods.pack.dialog.backupHint")
                  : t("servers-management:mods.pack.dialog.backupUnavailable")}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <Switch checked={wipe} onCheckedChange={setWipe} />
            <span className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {t("servers-management:mods.pack.dialog.wipeLabel")}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("servers-management:mods.pack.dialog.wipeHint")}
              </span>
            </span>
          </label>

          {wipe && !backup ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {t("servers-management:mods.pack.dialog.wipeWarning")}
            </p>
          ) : null}

          {!serverStopped ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {t("servers-management:mods.pack.stopRequired")}
            </p>
          ) : null}

          {version?.downloadable === false ? (
            <p className="text-sm text-muted-foreground">
              {t("servers-management:mods.manualDownloadHint")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => void start()}
            loading={isStarting}
            disabled={
              !version ||
              version.downloadable === false ||
              !serverStopped ||
              isStarting
            }
          >
            <Download data-icon="inline-start" />
            {isCurrent
              ? t("servers-management:mods.pack.reinstallButton")
              : installedVersion
                ? t("servers-management:mods.pack.switchButton")
                : t("servers-management:mods.installButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionMeta({ version }: { version: ResourceVersion }) {
  const parts = [
    version.version_type,
    version.published_at ? formatDate(version.published_at) : null,
    version.game_versions.slice(0, 3).join(", ") || null,
  ].filter(Boolean);

  return <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>;
}
