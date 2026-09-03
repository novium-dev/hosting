import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Download,
  Power,
  PowerOff,
  RefreshCw,
  Repeat,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import {
  modpackVersionsAction,
  unlinkModpackAction,
} from "@/actions/mod-browser";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import {
  LOADER_LABELS,
  PROVIDER_LABELS,
  type InstalledModpack,
  type ModpackMod,
  type ModpackVersions,
  type ResourceLoader,
  type ResourceProvider,
} from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";
import {
  ModpackInstallDialog,
  type ModpackTarget,
} from "./modpack-install-dialog";
import { ProjectList } from "./project-list";
import { SearchBar } from "./search-bar";
import {
  ProjectIcon,
  ProjectTitleLink,
  canMutate,
  formatTimestamp,
  versionLabel,
  type ModsContext,
} from "./shared";
import { useResourceSearch } from "./use-resource-search";

type ModpackPanelProps = {
  ctx: ModsContext;
  pack: InstalledModpack | null;
  onInstallStarted: () => void;
  onUnlinked: () => void;
  onToggleMod: (entry: ModpackMod) => void;
};

export function ModpackPanel({
  ctx,
  pack,
  onInstallStarted,
  onUnlinked,
  onToggleMod,
}: ModpackPanelProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<ModpackTarget | null>(null);
  const [initialVersion, setInitialVersion] = useState<string | undefined>();
  const [browsing, setBrowsing] = useState(false);
  const [allowPrerelease, setAllowPrerelease] = useState(false);

  const {
    data: packVersions,
    isValidating,
    mutate: refreshVersions,
  } = useSWR(
    pack ? ["modpack-versions", ctx.serverId, allowPrerelease] : null,
    async () => {
      const result = await modpackVersionsAction({
        serverId: ctx.serverId,
        allowPrerelease,
      });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? null;
    },
  );

  const openInstall = (next: ModpackTarget, version?: string) => {
    setInitialVersion(version);
    setTarget(next);
  };

  const started = () => {
    setBrowsing(false);
    void refreshVersions();
    onInstallStarted();
  };

  const unlink = async () => {
    const result = await unlinkModpackAction({ serverId: ctx.serverId });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(t("servers-management:mods.pack.toasts.unlinked"));
    onUnlinked();
  };

  return (
    <>
      {pack && !browsing ? (
        <LinkedPack
          ctx={ctx}
          pack={pack}
          versions={packVersions ?? null}
          isChecking={isValidating}
          allowPrerelease={allowPrerelease}
          onAllowPrereleaseChange={setAllowPrerelease}
          onCheck={() => void refreshVersions()}
          onInstall={openInstall}
          onReplace={() => setBrowsing(true)}
          onUnlink={unlink}
          onToggleMod={onToggleMod}
        />
      ) : (
        <PackBrowser
          ctx={ctx}
          hasPack={Boolean(pack)}
          onCancel={() => setBrowsing(false)}
          onInstall={openInstall}
        />
      )}

      <ModpackInstallDialog
        serverId={ctx.serverId}
        target={target}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        initialVersionId={initialVersion}
        installedVersion={pack?.version ?? null}
        backupAvailable={ctx.backupAvailable}
        serverStopped={ctx.serverStopped}
        onStarted={started}
      />
    </>
  );
}

type LinkedPackProps = {
  ctx: ModsContext;
  pack: InstalledModpack;
  versions: ModpackVersions | null;
  isChecking: boolean;
  allowPrerelease: boolean;
  onAllowPrereleaseChange: (value: boolean) => void;
  onCheck: () => void;
  onInstall: (target: ModpackTarget, version?: string) => void;
  onReplace: () => void;
  onUnlink: () => Promise<void>;
  onToggleMod: (entry: ModpackMod) => void;
};

function LinkedPack({
  ctx,
  pack,
  versions,
  isChecking,
  allowPrerelease,
  onAllowPrereleaseChange,
  onCheck,
  onInstall,
  onReplace,
  onUnlink,
  onToggleMod,
}: LinkedPackProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  const [contentsOpen, setContentsOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const loader = pack.loader ?? null;
  const target: ModpackTarget | null = loader
    ? {
        provider: pack.provider,
        project: pack.project,
        title: pack.title,
        loader,
        iconUrl: pack.icon_url,
        pageUrl: pack.page_url,
      }
    : null;

  const available = versions?.versions ?? [];
  const versionId = selected || versions?.installed_version || "";
  const isInstalledVersion = versionId === pack.version;
  const writable = canMutate(ctx) && ctx.serverStopped;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start gap-4">
        <ProjectIcon
          src={pack.icon_url}
          title={pack.title}
          className="size-14"
        />

        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <ProjectTitleLink href={pack.page_url} title={pack.title} />
            <Badge variant="secondary">{PROVIDER_LABELS[pack.provider]}</Badge>
            {loader ? (
              <Badge variant="outline">{LOADER_LABELS[loader]}</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {t("servers-management:mods.pack.installedSummary", {
              version: pack.version_number ?? pack.version,
              date: formatTimestamp(pack.installed_at),
            })}
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReplace}>
            <Repeat data-icon="inline-start" />
            {t("servers-management:mods.pack.replaceButton")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canMutate(ctx)}
            onClick={() => setUnlinkOpen(true)}
          >
            <Unlink data-icon="inline-start" />
            {t("servers-management:mods.pack.unlinkButton")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {versions?.update_available && versions.latest ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-sky-500/40 bg-sky-500/5 p-3">
            <ArrowUpCircle className="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="min-w-0 flex-1 text-sm">
              {t("servers-management:mods.pack.updateAvailable", {
                version: versions.latest.version_number,
              })}
            </span>
            <Button
              size="sm"
              disabled={!writable || !target}
              onClick={() =>
                target && onInstall(target, versions.latest?.id ?? undefined)
              }
            >
              <Download data-icon="inline-start" />
              {t("common:actions.update")}
            </Button>
          </div>
        ) : versions ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {t("servers-management:mods.pack.upToDate")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label htmlFor="linked-pack-version">
              {t("servers-management:mods.versionLabel")}
            </Label>
            <Select
              value={versionId}
              onValueChange={setSelected}
              disabled={available.length === 0}
            >
              <SelectTrigger id="linked-pack-version" className="w-full">
                <SelectValue
                  placeholder={
                    isChecking
                      ? t("servers-management:mods.loadingVersions")
                      : t("servers-management:mods.noVersions")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {available.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {versionLabel(entry)}
                    {entry.id === pack.version
                      ? ` · ${t("servers-management:mods.pack.currentSuffix")}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            disabled={!writable || !target || !versionId}
            onClick={() => target && onInstall(target, versionId)}
          >
            <Download data-icon="inline-start" />
            {isInstalledVersion
              ? t("servers-management:mods.pack.reinstallButton")
              : t("servers-management:mods.pack.switchButton")}
          </Button>

          <Button variant="outline" onClick={onCheck} loading={isChecking}>
            <RefreshCw data-icon="inline-start" />
            {t("servers-management:mods.pack.checkUpdatesButton")}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="pack-prerelease"
            checked={allowPrerelease}
            onCheckedChange={onAllowPrereleaseChange}
          />
          <Label
            htmlFor="pack-prerelease"
            className="text-sm font-normal text-muted-foreground"
          >
            {t("servers-management:mods.includeBeta")}
          </Label>
        </div>

        {loader ? null : (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("servers-management:mods.pack.unlinkedLoader")}
          </p>
        )}

        {ctx.serverStopped ? null : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("servers-management:mods.pack.stopRequired")}
          </p>
        )}

        <TaskLockNotice lock={ctx.storageLock} />

        <Separator />

        <Collapsible open={contentsOpen} onOpenChange={setContentsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-2">
              <span className="flex items-center gap-2">
                <Boxes className="size-4" />
                {t("servers-management:mods.pack.contents", {
                  mods: pack.mods.length,
                  files: pack.other_files,
                })}
              </span>
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  contentsOpen && "rotate-180",
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-2">
            {pack.mods.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t("servers-management:mods.pack.noModsOnDisk")}
              </p>
            ) : (
              pack.mods.map((entry) => (
                <div
                  key={`${entry.resource_type}:${entry.file_name}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-2 pl-3"
                >
                  <span
                    className={cn(
                      "truncate text-sm",
                      entry.enabled || "text-muted-foreground",
                    )}
                  >
                    {entry.file_name}
                  </span>
                  <span className="flex items-center gap-2">
                    {entry.enabled ? null : (
                      <Badge variant="outline">
                        {t("common:status.disabled")}
                      </Badge>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canMutate(ctx)}
                      onClick={() => onToggleMod(entry)}
                    >
                      {entry.enabled ? (
                        <PowerOff data-icon="inline-start" />
                      ) : (
                        <Power data-icon="inline-start" />
                      )}
                      {entry.enabled
                        ? t("servers-management:mods.actions.disable")
                        : t("servers-management:mods.actions.enable")}
                    </Button>
                  </span>
                </div>
              ))
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      <AlertDialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers-management:mods.pack.unlinkConfirm.title", {
                title: pack.title,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers-management:mods.pack.unlinkConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onUnlink()}>
              {t("servers-management:mods.pack.unlinkButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type PackBrowserProps = {
  ctx: ModsContext;
  hasPack: boolean;
  onCancel: () => void;
  onInstall: (target: ModpackTarget) => void;
};

function PackBrowser({ ctx, hasPack, onCancel, onInstall }: PackBrowserProps) {
  const { t } = useTranslation();
  const [loader, setLoader] = useState<ResourceLoader | null>(null);
  const [provider, setProvider] = useState<ResourceProvider | null>(null);
  const [compatibleOnly, setCompatibleOnly] = useState(true);

  const packLoaders = useMemo(
    () => ctx.loaders.filter((entry) => entry.modpack_providers.length > 0),
    [ctx.loaders],
  );
  const activeLoader =
    packLoaders.find((entry) => entry.loader === loader) ?? packLoaders[0];
  const providers = activeLoader?.modpack_providers ?? [];
  const activeProvider =
    providers.find((entry) => entry === provider) ?? providers[0] ?? null;

  const gameVersion =
    compatibleOnly && ctx.gameVersion ? ctx.gameVersion : undefined;

  const search = useResourceSearch({
    serverId: ctx.serverId,
    loader: activeLoader?.loader ?? null,
    provider: activeProvider,
    kind: "modpack",
    gameVersion,
  });

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="size-5" />
              {hasPack
                ? t("servers-management:mods.pack.replaceTitle")
                : t("servers-management:mods.pack.chooseTitle")}
            </CardTitle>
            <CardDescription>
              {t("servers-management:mods.pack.chooseDescription")}
            </CardDescription>
          </div>
          {hasPack ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t("common:actions.cancel")}
            </Button>
          ) : null}
        </div>

        <SearchBar
          id="pack-search"
          query={search.query}
          onQueryChange={search.setQuery}
          onSubmit={search.submit}
          isSearching={search.isSearching}
          placeholder={t("servers-management:mods.pack.searchPlaceholder")}
          providers={providers}
          provider={activeProvider}
          onProviderChange={setProvider}
          loaders={packLoaders.map((entry) => entry.loader)}
          loader={activeLoader?.loader ?? null}
          onLoaderChange={setLoader}
          gameVersion={ctx.gameVersion}
          compatibleOnly={compatibleOnly}
          onCompatibleOnlyChange={setCompatibleOnly}
        />
      </CardHeader>

      <CardContent>
        <ProjectList
          projects={search.projects}
          isLoading={search.isSearching}
          emptyLabel={t("servers-management:mods.noResults")}
          action={(project) => (
            <Button
              size="sm"
              disabled={
                !canMutate(ctx) ||
                !ctx.serverStopped ||
                !activeLoader ||
                !project.downloadable
              }
              onClick={() =>
                activeLoader &&
                onInstall({
                  provider: project.provider,
                  project: project.id,
                  title: project.title,
                  loader: activeLoader.loader,
                  iconUrl: project.icon_url,
                  pageUrl: project.page_url,
                })
              }
            >
              <Download data-icon="inline-start" />
              {t("servers-management:mods.installButton")}
            </Button>
          )}
        />
      </CardContent>
    </Card>
  );
}
