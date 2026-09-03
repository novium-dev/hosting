import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { Boxes, PackageSearch, Wrench } from "lucide-react";
import { toast } from "sonner";

import {
  getResourceContextAction,
  listInstalledResourcesAction,
  listResourceUpdatesAction,
  setResourceStateAction,
  uninstallResourceAction,
  updateAllResourcesAction,
  updateResourceAction,
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
import {
  LOADER_LABELS,
  type InstalledResource,
  type ModpackMod,
} from "@/lib/mod-browser/types";
import { BrowsePanel } from "./browse-panel";
import { InstalledPanel } from "./installed-panel";
import { ModpackPanel } from "./modpack-panel";
import type { ModsContext } from "./shared";

type ModPluginBrowserProps = {
  serverId: string;
  canWriteFiles: boolean;
};

type ModsTab = "modpack" | "browse" | "installed";

export function ModPluginBrowser({
  serverId,
  canWriteFiles,
}: ModPluginBrowserProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ModsTab | null>(null);
  const [allowPrerelease, setAllowPrerelease] = useState(false);

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
  const pack = contents?.modpack ?? null;
  const installed = useMemo(() => contents?.managed ?? [], [contents]);
  const modpacksAvailable = loaders.some(
    (entry) => entry.modpack_providers.length > 0,
  );

  const ctx: ModsContext = {
    serverId,
    canWriteFiles,
    installing,
    serverStopped: allowsOfflineWrite(status),
    storageLock,
    backupAvailable: context?.backup_available ?? false,
    gameVersion: context?.game_version ?? null,
    loaders,
  };

  const activeTab: ModsTab =
    tab ?? (modpacksAvailable && pack ? "modpack" : "browse");

  const refreshAll = async () => {
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  const handleToggle = async (
    resourceType: string,
    file: string,
    label: string,
    enabled: boolean,
  ) => {
    const result = await setResourceStateAction({
      serverId,
      resourceType: resourceType as "plugin" | "modification" | "data_pack",
      file,
      enabled,
    });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      enabled
        ? t("servers-management:mods.toasts.enabled", { label })
        : t("servers-management:mods.toasts.disabled", { label }),
    );
    await refreshInstalled();
  };

  const handleUpdate = async (entry: InstalledResource) => {
    const result = await updateResourceAction({
      serverId,
      provider: entry.provider,
      project: entry.project,
      allowPrerelease,
    });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      t("servers-management:mods.toasts.updated", { title: entry.title }),
    );
    await refreshAll();
  };

  const handleUpdateAll = async () => {
    const result = await updateAllResourcesAction({
      serverId,
      allowPrerelease,
    });

    if (result.serverError || !result.data) {
      toast.error(
        result.serverError ?? t("servers-management:mods.toasts.updateFailed"),
      );
      return;
    }

    const updated = result.data.filter((entry) => entry.version);
    for (const entry of result.data.filter((entry) => entry.error)) {
      toast.error(`${entry.title}: ${entry.error}`);
    }
    if (updated.length > 0) {
      toast.success(
        t("servers-management:mods.toasts.updatedCount", {
          count: updated.length,
        }),
      );
    }

    await refreshAll();
  };

  const handleUninstall = async (entry: InstalledResource) => {
    const result = await uninstallResourceAction({
      serverId,
      provider: entry.provider,
      project: entry.project,
    });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      t("servers-management:mods.toasts.removed", { title: entry.title }),
    );
    await refreshAll();
  };

  const handlePackMod = (entry: ModpackMod) =>
    void handleToggle(
      entry.resource_type,
      entry.file_name,
      entry.file_name,
      !entry.enabled,
    );

  if (context && loaders.length === 0) {
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
        <Tabs
          value={activeTab}
          onValueChange={(value) => setTab(value as ModsTab)}
        >
          <TabsList>
            {modpacksAvailable ? (
              <TabsTrigger value="modpack">
                <Boxes className="mr-1 size-4" />
                {t("servers-management:mods.tabs.modpack")}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="browse">
              <PackageSearch className="mr-1 size-4" />
              {t("servers-management:mods.tabs.browse")}
            </TabsTrigger>
            <TabsTrigger value="installed">
              <Wrench className="mr-1 size-4" />
              {t("servers-management:mods.tabs.installed")}
              {updates.length > 0 ? (
                <Badge variant="secondary" className="ml-1.5">
                  {updates.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          {ctx.gameVersion ? (
            <Badge variant="outline">{ctx.gameVersion}</Badge>
          ) : null}
          {loaders.length === 1 ? (
            <Badge variant="secondary">
              {LOADER_LABELS[loaders[0].loader]}
            </Badge>
          ) : null}
        </div>
      </div>

      {activeTab === "modpack" && modpacksAvailable ? (
        <ModpackPanel
          ctx={ctx}
          pack={pack}
          onInstallStarted={() => {
            void refreshJob();
            void refreshAll();
          }}
          onToggleMod={handlePackMod}
        />
      ) : null}

      {activeTab === "browse" ? (
        <BrowsePanel
          ctx={ctx}
          installed={installed}
          onInstalled={() => void refreshAll()}
        />
      ) : null}

      {activeTab === "installed" ? (
        <InstalledPanel
          ctx={ctx}
          installed={installed}
          unmanaged={contents?.unmanaged ?? []}
          unreadable={contents?.unreadable ?? []}
          updates={updates}
          allowPrerelease={allowPrerelease}
          onAllowPrereleaseChange={setAllowPrerelease}
          onUpdate={(entry) => void handleUpdate(entry)}
          onUpdateAll={() => void handleUpdateAll()}
          onToggle={(resourceType, file, label, enabled) =>
            void handleToggle(resourceType, file, label, enabled)
          }
          onUninstall={(entry) => void handleUninstall(entry)}
        />
      ) : null}
    </div>
  );
}
