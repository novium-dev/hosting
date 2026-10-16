import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Boxes,
  CheckCircle2,
  Download,
  PackageSearch,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import type {
  InstalledModpack,
  InstalledResource,
  ResourceLoader,
  ResourceProject,
  ResourceProvider,
} from "@/lib/mod-browser/types";
import { ModpackBrowse } from "./modpack-browse";
import type { ModpackTarget } from "./modpack-install-dialog";
import { ProjectList } from "./project-list";
import { ResourceInstallDialog } from "./resource-install-dialog";
import { SearchBar } from "./search-bar";
import { canMutate, installKey, type ModsContext } from "./shared";
import { useResourceSearch } from "./use-resource-search";

export type BrowseKind = "resource" | "modpack";

type BrowsePanelProps = {
  ctx: ModsContext;
  kind: BrowseKind;
  onKindChange: (kind: BrowseKind) => void;
  installed: InstalledResource[];
  pack: InstalledModpack | null;
  onInstalled: () => void;
  onInstallPack: (target: ModpackTarget) => void;
};

export function BrowsePanel({
  ctx,
  kind,
  onKindChange,
  installed,
  pack,
  onInstalled,
  onInstallPack,
}: BrowsePanelProps) {
  const { t } = useTranslation();
  const modpacksAvailable = ctx.modpackLoaders.length > 0;
  const resourcesAvailable = ctx.loaders.length > 0;
  const activeKind: BrowseKind =
    kind === "modpack" && modpacksAvailable
      ? "modpack"
      : resourcesAvailable
        ? "resource"
        : "modpack";

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {activeKind === "modpack" ? (
                <Boxes className="size-5" />
              ) : (
                <PackageSearch className="size-5" />
              )}
              {activeKind === "modpack"
                ? pack
                  ? t("servers-management:mods.pack.replaceTitle")
                  : t("servers-management:mods.pack.chooseTitle")
                : t("servers-management:mods.browse.title")}
            </CardTitle>
            <CardDescription>
              {activeKind === "modpack"
                ? t("servers-management:mods.pack.chooseDescription")
                : t("servers-management:mods.browse.description")}
            </CardDescription>
          </div>

          {modpacksAvailable && resourcesAvailable ? (
            <Tabs
              value={activeKind}
              onValueChange={(value) => onKindChange(value as BrowseKind)}
            >
              <TabsList>
                <TabsTrigger value="resource">
                  {t("servers-management:mods.browse.kindResources")}
                </TabsTrigger>
                <TabsTrigger value="modpack">
                  {t("servers-management:mods.browse.kindModpacks")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>
      </CardHeader>

      {activeKind === "modpack" ? (
        <CardContent>
          <ModpackBrowse ctx={ctx} pack={pack} onInstall={onInstallPack} />
        </CardContent>
      ) : (
        <ResourceBrowse
          ctx={ctx}
          installed={installed}
          onInstalled={onInstalled}
        />
      )}
    </Card>
  );
}

function ResourceBrowse({
  ctx,
  installed,
  onInstalled,
}: {
  ctx: ModsContext;
  installed: InstalledResource[];
  onInstalled: () => void;
}) {
  const { t } = useTranslation();
  const [loader, setLoader] = useState<ResourceLoader | null>(null);
  const [provider, setProvider] = useState<ResourceProvider | null>(null);
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [selected, setSelected] = useState<ResourceProject | null>(null);

  const activeLoader =
    ctx.loaders.find((entry) => entry.loader === loader) ?? ctx.loaders[0];
  const providers = activeLoader?.providers ?? [];
  const activeProvider =
    providers.find((entry) => entry === provider) ?? providers[0] ?? null;

  const gameVersion =
    compatibleOnly && ctx.gameVersion ? ctx.gameVersion : undefined;

  const search = useResourceSearch({
    serverId: ctx.serverId,
    loader: activeLoader?.loader ?? null,
    provider: activeProvider,
    kind: "resource",
    gameVersion,
  });

  const installedByProject = useMemo(
    () =>
      new Map(
        installed.map((entry) => [
          installKey(entry.provider, entry.project),
          entry,
        ]),
      ),
    [installed],
  );

  const selectedInstall = selected
    ? (installedByProject.get(installKey(selected.provider, selected.id)) ??
      null)
    : null;

  return (
    <>
      <CardHeader className="gap-4 pt-0">
        <SearchBar
          id="resource-search"
          query={search.query}
          onQueryChange={search.setQuery}
          onSubmit={search.submit}
          isSearching={search.isSearching}
          placeholder={t("servers-management:mods.browse.searchPlaceholder")}
          providers={providers}
          provider={activeProvider}
          onProviderChange={setProvider}
          loaders={ctx.loaders.map((entry) => entry.loader)}
          loader={activeLoader?.loader ?? null}
          onLoaderChange={setLoader}
          gameVersion={ctx.gameVersion}
          compatibleOnly={compatibleOnly}
          onCompatibleOnlyChange={setCompatibleOnly}
        />

        <TaskLockNotice lock={ctx.storageLock} />
      </CardHeader>

      <CardContent>
        <ProjectList
          projects={search.projects}
          isLoading={search.isSearching}
          emptyLabel={t("servers-management:mods.noResults")}
          status={(project) =>
            installedByProject.has(installKey(project.provider, project.id)) ? (
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="size-3" />
                {t("servers-management:mods.badges.installed")}
              </Badge>
            ) : null
          }
          action={(project) => {
            const entry = installedByProject.get(
              installKey(project.provider, project.id),
            );

            return (
              <Button
                size="sm"
                variant={entry ? "outline" : "default"}
                disabled={!canMutate(ctx) || !project.downloadable}
                onClick={() => setSelected(project)}
              >
                {entry ? (
                  <RefreshCw data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {entry
                  ? t("servers-management:mods.switchVersionButton")
                  : t("servers-management:mods.installButton")}
              </Button>
            );
          }}
        />
      </CardContent>

      <ResourceInstallDialog
        serverId={ctx.serverId}
        project={selected}
        loader={activeLoader?.loader ?? null}
        gameVersion={gameVersion}
        installedVersion={selectedInstall?.version ?? null}
        canInstall={canMutate(ctx)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onInstalled={onInstalled}
      />
    </>
  );
}
