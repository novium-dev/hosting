import { useEffect, useEffectEvent, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { LayoutList, PackageSearch } from "lucide-react";

import {
  getResourceContextAction,
  listInstalledResourcesAction,
  listResourceUpdatesAction,
} from "@/actions/mod-browser";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModpackJob } from "@/hooks/use-modpack-job";
import { allowsOfflineWrite } from "@/lib/server-status";
import { useServerStatus } from "@/stores/server-status";
import { useServerTaskLock } from "@/stores/server-tasks";
import { BrowsePanel, type BrowseKind } from "./browse-panel";
import { ContentPanel } from "./content-panel";
import {
  ModpackInstallDialog,
  type ModpackTarget,
} from "./modpack-install-dialog";
import { LOADER_NAMES, type ModsContext } from "./shared";

type ModPluginBrowserProps = {
  serverId: string;
  canWriteFiles: boolean;
};

type ModsTab = "content" | "browse";

export function ModPluginBrowser({
  serverId,
  canWriteFiles,
}: ModPluginBrowserProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ModsTab>("content");
  const [browseKind, setBrowseKind] = useState<BrowseKind>("resource");
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [packTarget, setPackTarget] = useState<ModpackTarget | null>(null);
  const [packVersion, setPackVersion] = useState<string | undefined>();

  const storageLock = useServerTaskLock(serverId, "storage", "write");
  const status = useServerStatus(serverId);
  const { installing, refresh: refreshJob } = useModpackJob(serverId);

  const { data: context } = useSWR(["resource-context", serverId], async () => {
    const result = await getResourceContextAction({ serverId });
    if (result.serverError) throw new Error(result.serverError);
    return result.data ?? null;
  });

  const { data: contents, mutate: refreshInstalled } = useSWR(
    ["installed-resources", serverId],
    async () => {
      const result = await listInstalledResourcesAction({ serverId });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? null;
    },
  );

  const { data: updates = [], mutate: refreshUpdates } = useSWR(
    ["resource-updates", serverId, allowPrerelease],
    async () => {
      const result = await listResourceUpdatesAction({
        serverId,
        allowPrerelease,
      });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? [];
    },
  );

  const loaders = useMemo(() => context?.loaders ?? [], [context]);
  const modpackLoaders = useMemo(
    () => context?.modpack_loaders ?? [],
    [context],
  );
  const pack = contents?.modpack ?? null;
  const installed = useMemo(() => contents?.managed ?? [], [contents]);

  const ctx: ModsContext = {
    serverId,
    canWriteFiles,
    canChangePlatform: context?.can_change_platform ?? false,
    installing,
    serverStopped: allowsOfflineWrite(status),
    storageLock,
    backupAvailable: context?.backup_available ?? false,
    gameVersion: context?.game_version ?? null,
    loaders,
    modpackLoaders,
  };

  const refreshAll = async () => {
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  const refreshAfterJob = useEffectEvent(() => {
    void refreshAll();
  });

  useEffect(() => {
    if (!installing) refreshAfterJob();
  }, [installing]);

  const browse = (kind: BrowseKind) => {
    setBrowseKind(kind);
    setTab("browse");
  };

  const openPackInstall = (target: ModpackTarget, version?: string) => {
    setPackVersion(version);
    setPackTarget(target);
  };

  if (context && loaders.length === 0 && modpackLoaders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>
            {t("servers-management:mods.unavailable.title")}
          </CardTitle>
          <CardDescription>
            {t("servers-management:mods.unavailable.description")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as ModsTab)}>
          <TabsList>
            <TabsTrigger value="content">
              <LayoutList className="mr-1 size-4" />
              {t("servers-management:mods.tabs.content")}
              {updates.length > 0 ? (
                <Badge variant="secondary" className="ml-1.5">
                  {updates.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="browse">
              <PackageSearch className="mr-1 size-4" />
              {t("servers-management:mods.tabs.browse")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          {loaders.length === 1 ? (
            <Badge variant="secondary">{LOADER_NAMES[loaders[0].loader]}</Badge>
          ) : null}
          {ctx.gameVersion ? (
            <Badge variant="outline">
              {t("servers-management:mods.pack.minecraftBadge", {
                version: ctx.gameVersion,
              })}
            </Badge>
          ) : null}
        </div>
      </div>

      {tab === "content" ? (
        <ContentPanel
          ctx={ctx}
          pack={pack}
          installed={installed}
          unmanaged={contents?.unmanaged ?? []}
          unreadable={contents?.unreadable ?? []}
          updates={updates}
          allowPrerelease={allowPrerelease}
          onAllowPrereleaseChange={setAllowPrerelease}
          onChanged={refreshAll}
          onBrowse={browse}
          onInstallPack={openPackInstall}
        />
      ) : (
        <BrowsePanel
          ctx={ctx}
          kind={browseKind}
          onKindChange={setBrowseKind}
          installed={installed}
          pack={pack}
          onInstalled={() => void refreshAll()}
          onInstallPack={(target) => openPackInstall(target)}
        />
      )}

      <ModpackInstallDialog
        ctx={ctx}
        target={packTarget}
        onOpenChange={(open) => {
          if (!open) setPackTarget(null);
        }}
        initialVersionId={packVersion}
        pack={pack}
        onStarted={() => {
          setTab("content");
          void refreshJob();
          void refreshAll();
        }}
      />
    </div>
  );
}
