import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { Boxes, Download, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  installModpackAction,
  listResourceVersionsAction,
} from "@/actions/mod-browser";
import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  InstalledModpack,
  ResourceLoader,
  ResourceProvider,
  ResourceVersion,
} from "@/lib/mod-browser/types";
import {
  LOADER_NAMES,
  ProjectIcon,
  formatDate,
  versionLabel,
  type ModsContext,
} from "./shared";

export type ModpackTarget = {
  provider: ResourceProvider;
  project: string;
  title: string;
  loader: ResourceLoader;
  iconUrl?: string | null;
  pageUrl?: string | null;
  reset?: boolean;
};

type ModpackInstallDialogProps = {
  ctx: ModsContext;
  target: ModpackTarget | null;
  onOpenChange: (open: boolean) => void;
  initialVersionId?: string;
  pack: InstalledModpack | null;
  onStarted: () => void;
};

type Choice = {
  targetKey: string;
  versionId?: string;
  backup?: boolean;
  reset?: boolean;
  syncPlatform?: boolean;
};

export function ModpackInstallDialog({
  ctx,
  target,
  onOpenChange,
  initialVersionId,
  pack,
  onStarted,
}: ModpackInstallDialogProps) {
  const { t } = useTranslation();
  const targetKey = target ? `${target.provider}:${target.project}` : "";
  const [choice, setChoice] = useState<Choice>({ targetKey });
  const ownChoice: Choice =
    choice.targetKey === targetKey ? choice : { targetKey };
  const [isStarting, setIsStarting] = useState(false);

  const { data: versions = [], isLoading } = useSWR(
    target
      ? [
          "modpack-install-versions",
          ctx.serverId,
          target.provider,
          target.project,
        ]
      : null,
    async () => {
      if (!target) return [];
      const result = await listResourceVersionsAction({
        serverId: ctx.serverId,
        provider: target.provider,
        project: target.project,
        loader: target.loader,
        kind: "modpack",
      });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? [];
    },
  );

  const samePack = Boolean(
    pack &&
    target &&
    pack.provider === target.provider &&
    pack.project === target.project,
  );
  const switchesLoader = ctx.modpackLoaders.some(
    (entry) => entry.loader === target?.loader && entry.switches_platform,
  );

  const versionId =
    ownChoice.versionId || initialVersionId || versions[0]?.id || "";
  const backup = ownChoice.backup ?? ctx.backupAvailable;
  const reset = ownChoice.reset ?? target?.reset ?? !samePack;
  const syncPlatform = ownChoice.syncPlatform ?? ctx.canChangePlatform;
  const update = (next: Partial<Choice>) =>
    setChoice({ ...ownChoice, ...next });

  const version = versions.find((entry) => entry.id === versionId) ?? null;
  const isCurrent = samePack && pack?.version === version?.id;
  const gameMismatch = Boolean(
    version &&
    ctx.gameVersion &&
    version.game_versions.length > 0 &&
    !version.game_versions.includes(ctx.gameVersion),
  );
  const platformChanges = switchesLoader || gameMismatch;
  const blockedByPlatform = platformChanges && !syncPlatform;

  const start = async () => {
    if (!target || !version) return;

    setIsStarting(true);
    const result = await installModpackAction({
      serverId: ctx.serverId,
      provider: target.provider,
      project: target.project,
      version: version.id,
      loader: target.loader,
      title: target.title,
      versionNumber: version.version_number,
      iconUrl: target.iconUrl ?? undefined,
      pageUrl: target.pageUrl ?? undefined,
      backup,
      mode: reset ? "reset" : "keep",
      syncPlatform: syncPlatform && ctx.canChangePlatform,
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

  const actionLabel = isCurrent
    ? t("servers-management:mods.pack.reinstallButton")
    : samePack
      ? t("servers-management:mods.pack.switchButton")
      : t("servers-management:mods.installButton");

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-5" />
            {target
              ? samePack
                ? t("servers-management:mods.pack.dialog.changeTitle", {
                    title: target.title,
                  })
                : t("servers-management:mods.pack.dialog.title", {
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
                  {PROVIDER_LABELS[target.provider]} ·{" "}
                  {LOADER_NAMES[target.loader]}
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
              onValueChange={(value) => update({ versionId: value ?? "" })}
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
                    {samePack && entry.id === pack?.version
                      ? ` · ${t("servers-management:mods.pack.currentSuffix")}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {version ? <VersionMeta version={version} /> : null}
            {version?.changelog ? (
              <ScrollArea className="max-h-40 rounded-md border bg-muted/30">
                <p className="p-3 text-sm whitespace-pre-wrap text-muted-foreground">
                  {version.changelog}
                </p>
              </ScrollArea>
            ) : null}
          </div>

          <OptionSwitch
            checked={reset}
            onCheckedChange={(value) => update({ reset: value })}
            label={t("servers-management:mods.pack.dialog.resetLabel")}
            hint={
              reset
                ? t("servers-management:mods.pack.dialog.resetHint")
                : t("servers-management:mods.pack.dialog.keepHint")
            }
          />

          <OptionSwitch
            checked={backup}
            disabled={!ctx.backupAvailable}
            onCheckedChange={(value) => update({ backup: value })}
            label={t("servers-management:mods.pack.dialog.backupLabel")}
            hint={
              ctx.backupAvailable
                ? t("servers-management:mods.pack.dialog.backupHint")
                : t("servers-management:mods.pack.dialog.backupUnavailable")
            }
          />

          {ctx.canChangePlatform ? (
            <OptionSwitch
              checked={syncPlatform}
              onCheckedChange={(value) => update({ syncPlatform: value })}
              label={t("servers-management:mods.pack.dialog.platformLabel")}
              hint={t("servers-management:mods.pack.dialog.platformHint")}
            />
          ) : null}

          {platformChanges && syncPlatform ? (
            <Notice tone="info">
              {t("servers-management:mods.pack.dialog.platformChange", {
                loader: target ? LOADER_NAMES[target.loader] : "",
                gameVersion:
                  version?.game_versions.slice(0, 3).join(", ") ?? "",
              })}
            </Notice>
          ) : null}

          {blockedByPlatform ? (
            <Notice tone="warning">
              {ctx.canChangePlatform
                ? t("servers-management:mods.pack.dialog.platformBlocked")
                : t("servers-management:mods.pack.dialog.platformNoPermission")}
            </Notice>
          ) : null}

          {reset && !backup ? (
            <Notice tone="danger">
              {t("servers-management:mods.pack.dialog.resetWarning")}
            </Notice>
          ) : null}

          {!ctx.serverStopped ? (
            <Notice tone="warning">
              {t("servers-management:mods.pack.stopRequired")}
            </Notice>
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
              !ctx.serverStopped ||
              blockedByPlatform ||
              isStarting
            }
          >
            <Download data-icon="inline-start" />
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OptionSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  hint: string;
};

function OptionSwitch({
  checked,
  disabled,
  onCheckedChange,
  label,
  hint,
}: OptionSwitchProps) {
  return (
    <label className="flex items-start gap-3">
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

const NOTICE_TONES = {
  info: "border-sky-500/40 bg-sky-500/5",
  warning: "border-amber-500/40 bg-amber-500/5",
  danger: "border-destructive/40 bg-destructive/5",
} as const;

function Notice({
  tone,
  children,
}: {
  tone: keyof typeof NOTICE_TONES;
  children: ReactNode;
}) {
  return (
    <p
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${NOTICE_TONES[tone]}`}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

function VersionMeta({ version }: { version: ResourceVersion }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      <Badge variant="outline">{version.version_type}</Badge>
      {version.game_versions.slice(0, 4).map((gameVersion) => (
        <Badge key={gameVersion} variant="secondary">
          {gameVersion}
        </Badge>
      ))}
      {version.published_at ? (
        <span>{formatDate(version.published_at)}</span>
      ) : null}
    </div>
  );
}
