import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Download, Repeat } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  InstalledModpack,
  ResourceLoader,
  ResourceProvider,
} from "@/lib/mod-browser/types";
import type { ModpackTarget } from "./modpack-install-dialog";
import { ProjectList } from "./project-list";
import { SearchBar } from "./search-bar";
import { LOADER_NAMES, canMutate, type ModsContext } from "./shared";
import { useResourceSearch } from "./use-resource-search";

type ModpackBrowseProps = {
  ctx: ModsContext;
  pack: InstalledModpack | null;
  onInstall: (target: ModpackTarget) => void;
};

export function ModpackBrowse({ ctx, pack, onInstall }: ModpackBrowseProps) {
  const { t } = useTranslation();
  const [loader, setLoader] = useState<ResourceLoader | null>(null);
  const [provider, setProvider] = useState<ResourceProvider | null>(null);
  const [compatibleOnly, setCompatibleOnly] = useState(true);

  const activeLoader =
    ctx.modpackLoaders.find((entry) => entry.loader === loader) ??
    ctx.modpackLoaders.find((entry) => !entry.switches_platform) ??
    ctx.modpackLoaders[0];
  const providers = activeLoader?.providers ?? [];
  const activeProvider =
    providers.find((entry) => entry === provider) ?? providers[0] ?? null;
  const switches = activeLoader?.switches_platform ?? false;

  const gameVersion =
    compatibleOnly && ctx.gameVersion && !switches
      ? ctx.gameVersion
      : undefined;

  const search = useResourceSearch({
    serverId: ctx.serverId,
    loader: activeLoader?.loader ?? null,
    provider: activeProvider,
    kind: "modpack",
    gameVersion,
  });

  return (
    <div className="flex flex-col gap-4">
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
        loaders={ctx.modpackLoaders.map((entry) => entry.loader)}
        loader={activeLoader?.loader ?? null}
        onLoaderChange={setLoader}
        loaderLabels={LOADER_NAMES}
        gameVersion={switches ? null : ctx.gameVersion}
        compatibleOnly={compatibleOnly}
        onCompatibleOnlyChange={setCompatibleOnly}
      />

      {switches && activeLoader ? (
        <p className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
          <Repeat className="mt-0.5 size-4 shrink-0" />
          {t("servers-management:mods.pack.switchesPlatform", {
            loader: LOADER_NAMES[activeLoader.loader],
          })}
        </p>
      ) : null}

      <ProjectList
        projects={search.projects}
        isLoading={search.isSearching}
        emptyLabel={t("servers-management:mods.noResults")}
        status={(project) =>
          pack &&
          pack.provider === project.provider &&
          pack.project === project.id ? (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="size-3" />
              {t("servers-management:mods.badges.installed")}
            </Badge>
          ) : null
        }
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
    </div>
  );
}
