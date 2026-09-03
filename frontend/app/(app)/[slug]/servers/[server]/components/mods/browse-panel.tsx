import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Download, PackageSearch, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import type {
  InstalledResource,
  ResourceLoader,
  ResourceProject,
  ResourceProvider,
} from "@/lib/mod-browser/types";
import { ProjectList } from "./project-list";
import { ResourceInstallDialog } from "./resource-install-dialog";
import { SearchBar } from "./search-bar";
import { canMutate, installKey, type ModsContext } from "./shared";
import { useResourceSearch } from "./use-resource-search";

type BrowsePanelProps = {
  ctx: ModsContext;
  installed: InstalledResource[];
  onInstalled: () => void;
};

export function BrowsePanel({ ctx, installed, onInstalled }: BrowsePanelProps) {
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
    <Card>
      <CardHeader className="gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <PackageSearch className="size-5" />
            {t("servers-management:mods.browse.title")}
          </CardTitle>
          <CardDescription>
            {t("servers-management:mods.browse.description")}
          </CardDescription>
        </div>

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
    </Card>
  );
}
