"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileQuestion,
  PackageSearch,
  RefreshCw,
  ArrowUpCircle,
  Boxes,
  Power,
  PowerOff,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  getResourceContextAction,
  installModpackAction,
  installResourceVersionAction,
  modpackStatusAction,
  listInstalledResourcesAction,
  listResourceUpdatesAction,
  listResourceVersionsAction,
  searchResourceProjectsAction,
  updateAllResourcesAction,
  updateResourceAction,
  setResourceStateAction,
  uninstallResourceAction,
} from "@/actions/mod-browser";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LOADER_LABELS,
  PROVIDER_LABELS,
  RESOURCE_TYPE_LABELS,
  type InstalledResource,
  type ResourceKind,
  type ResourceLoader,
  type ResourceProject,
  type ResourceProvider,
  type ResourceVersion,
} from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";

type ModPluginBrowserProps = {
  serverId: string;
  canWriteFiles: boolean;
};

function installKey(provider: ResourceProvider, project: string) {
  return `${provider}:${project}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSize(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getInitials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ModPluginBrowser({
  serverId,
  canWriteFiles,
}: ModPluginBrowserProps) {
  const { t } = useTranslation();
  const [activeLoader, setActiveLoader] = useState<ResourceLoader | null>(null);
  const [activeProvider, setActiveProvider] = useState<ResourceProvider | null>(
    null,
  );
  const [kind, setKind] = useState<ResourceKind>("resource");
  const [query, setQuery] = useState("");
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [modpackConfirmOpen, setModpackConfirmOpen] = useState(false);
  const [modpackBackup, setModpackBackup] = useState(true);
  const [modpackWipe, setModpackWipe] = useState(true);
  const [projects, setProjects] = useState<ResourceProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ResourceProject | null>(
    null,
  );
  const [versions, setVersions] = useState<ResourceVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [isPending, startTransition] = useTransition();

  const { data: context } = useSWR(["resource-context", serverId], async () => {
    const result = await getResourceContextAction({ serverId });
    if (result.serverError) throw new Error(result.serverError);
    return result.data ?? null;
  });

  // The installed set comes from the backend's `server_resources` table, so a
  // single request answers "is this installed, and at which version" for every
  // search hit at once.
  const { data: contents, mutate: refreshInstalled } = useSWR(
    ["installed-resources", serverId],
    async () => {
      const result = await listInstalledResourcesAction({ serverId });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? null;
    },
  );

  const installed = useMemo(() => contents?.managed ?? [], [contents]);
  const unmanaged = useMemo(() => contents?.unmanaged ?? [], [contents]);
  const installedModpack = contents?.modpack ?? null;
  const unreadable = useMemo(() => contents?.unreadable ?? [], [contents]);

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

  const updateByProject = useMemo(
    () =>
      new Map(
        updates.map((entry) => [installKey(entry.provider, entry.project), entry]),
      ),
    [updates],
  );

  // Polled only while a job is in flight; a pack is minutes of work.
  const { data: modpackJob, mutate: refreshModpackJob } = useSWR(
    ["modpack-status", serverId],
    async () => {
      const result = await modpackStatusAction({ serverId });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? null;
    },
    { refreshInterval: (latest) => (latest?.state === "running" ? 2000 : 0) },
  );

  const installedByProject = useMemo(() => {
    const map = new Map<string, InstalledResource>();
    for (const entry of installed) {
      map.set(installKey(entry.provider, entry.project), entry);
    }
    return map;
  }, [installed]);

  const loaders = useMemo(() => context?.loaders ?? [], [context]);
  const activeLoaderInfo = useMemo(
    () => loaders.find((entry) => entry.loader === activeLoader) ?? loaders[0],
    [activeLoader, loaders],
  );
  const providers = useMemo(
    () =>
      (kind === "modpack"
        ? activeLoaderInfo?.modpack_providers
        : activeLoaderInfo?.providers) ?? [],
    [activeLoaderInfo, kind],
  );
  const modpacksAvailable =
    (activeLoaderInfo?.modpack_providers.length ?? 0) > 0;
  const provider = useMemo(
    () =>
      providers.find((entry) => entry === activeProvider) ?? providers[0] ?? null,
    [activeProvider, providers],
  );

  const backupAvailable = context?.backup_available ?? false;

  // Default is back up then wipe; with no backup possible the safe default
  // becomes a merge, so nothing is destroyed unprotected.
  useEffect(() => {
    setModpackBackup(backupAvailable);
    setModpackWipe(backupAvailable);
  }, [backupAvailable]);

  const gameVersion = context?.game_version ?? null;
  const versionFilter = compatibleOnly && gameVersion ? gameVersion : undefined;

  const searchAction = searchResourceProjectsAction;
  const versionsAction = listResourceVersionsAction;

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );
  const selectedInstall = selectedProject
    ? installedByProject.get(
        installKey(selectedProject.provider, selectedProject.id),
      )
    : undefined;

  const runSearch = (nextQuery = query) => {
    if (!activeLoaderInfo || !provider) return;

    startTransition(async () => {
      const result = await searchAction({
        serverId,
        provider,
        query: nextQuery,
        loader: activeLoaderInfo.loader,
        kind,
        gameVersion: versionFilter,
      });

      if (result.data) {
        setProjects(result.data);
        setSelectedProject(result.data[0] ?? null);
      } else if (result.serverError) {
        toast.error(result.serverError);
        setProjects([]);
        setSelectedProject(null);
      }
    });
  };

  // Re-run the search whenever the thing being searched changes. The query
  // itself is deliberately not a dependency: it is submitted explicitly.
  useEffect(() => {
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLoaderInfo?.loader, provider, kind, versionFilter]);

  useEffect(() => {
    if (!selectedProject || !activeLoaderInfo) {
      setVersions([]);
      setSelectedVersionId("");
      return;
    }

    let ignore = false;

    startTransition(async () => {
      const result = await versionsAction({
        serverId,
        provider: selectedProject.provider,
        project: selectedProject.id,
        loader: activeLoaderInfo.loader,
        kind,
        gameVersion: versionFilter,
      });

      if (ignore) return;

      if (result.data) {
        setVersions(result.data);
        setSelectedVersionId(result.data[0]?.id ?? "");
      } else {
        if (result.serverError) toast.error(result.serverError);
        setVersions([]);
        setSelectedVersionId("");
      }
    });

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLoaderInfo?.loader, selectedProject?.provider, selectedProject?.id, versionFilter]);

  const handleInstall = async () => {
    if (!activeLoaderInfo || !selectedProject || !selectedVersion) return;

    const result = await installResourceVersionAction({
      serverId,
      provider: selectedProject.provider,
      project: selectedProject.id,
      version: selectedVersion.id,
      loader: activeLoaderInfo.loader,
      title: selectedProject.title,
    });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      t("servers-management:modPluginBrowser.toasts.installed", {
        title: selectedProject.title,
      }),
    );
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  const handleSetState = async (
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
        ? t("servers-management:modPluginBrowser.toasts.stateEnabled", {
            label,
          })
        : t("servers-management:modPluginBrowser.toasts.stateDisabled", {
            label,
          }),
    );
    await refreshInstalled();
  };

  const handleInstallModpack = async () => {
    if (!activeLoaderInfo || !selectedProject || !selectedVersion) return;

    setModpackConfirmOpen(false);

    const result = await installModpackAction({
      serverId,
      provider: selectedProject.provider,
      project: selectedProject.id,
      version: selectedVersion.id,
      loader: activeLoaderInfo.loader,
      title: selectedProject.title,
      backup: modpackBackup,
      wipe: modpackWipe,
    });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      t(
        "servers-management:modPluginBrowser.toasts.installingInBackground",
        { title: selectedProject.title },
      ),
    );
    await refreshModpackJob();
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
      t("servers-management:modPluginBrowser.toasts.updated", {
        title: entry.title,
      }),
    );
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  const handleUpdateAll = async () => {
    const result = await updateAllResourcesAction({ serverId, allowPrerelease });

    if (result.serverError || !result.data) {
      toast.error(
        result.serverError ??
          t("servers-management:modPluginBrowser.toasts.updateAllFailed"),
      );
      return;
    }

    const updated = result.data.filter((entry) => entry.version);
    const failed = result.data.filter((entry) => entry.error);

    if (updated.length > 0) {
      toast.success(
        t("servers-management:modPluginBrowser.toasts.updatedCount", {
          count: updated.length,
        }),
      );
    }
    // Reported per resource: one blocked download must not read as a total
    // failure when the rest went through.
    for (const entry of failed) {
      toast.error(`${entry.title}: ${entry.error}`);
    }

    await Promise.all([refreshInstalled(), refreshUpdates()]);
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
      t("servers-management:modPluginBrowser.toasts.removed", {
        title: entry.title,
      }),
    );
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  if (context && loaders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>
            {t("servers-management:modPluginBrowser.unavailable.title")}
          </CardTitle>
          <CardDescription>
            {t("servers-management:modPluginBrowser.unavailable.description")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Card>
          <CardHeader className="gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PackageSearch className="size-5" />
                {t("servers-management:modPluginBrowser.title")}
              </CardTitle>
              <CardDescription>
                {kind === "modpack"
                  ? t("servers-management:modPluginBrowser.description.modpacks")
                  : t(
                      "servers-management:modPluginBrowser.description.resources",
                    )}
              </CardDescription>
            </div>

            {modpacksAvailable ? (
              <Tabs
                value={kind}
                onValueChange={(value) => {
                  setKind(value as ResourceKind);
                  setActiveProvider(null);
                  setSelectedProject(null);
                }}
              >
                <TabsList className="flex h-auto flex-wrap justify-start">
                  <TabsTrigger value="resource">
                    <PackageSearch className="mr-1 size-4" />
                    {t("servers-management:modPluginBrowser.tabs.mods")}
                  </TabsTrigger>
                  <TabsTrigger value="modpack">
                    <Boxes className="mr-1 size-4" />
                    {t("servers-management:modPluginBrowser.tabs.modpacks")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}

            {loaders.length > 1 && activeLoaderInfo ? (
              <Tabs
                value={activeLoaderInfo.loader}
                onValueChange={(value) => {
                  setActiveLoader(value as ResourceLoader);
                  setActiveProvider(null);
                }}
              >
                <TabsList className="flex h-auto flex-wrap justify-start">
                  {loaders.map((entry) => (
                    <TabsTrigger key={entry.loader} value={entry.loader}>
                      {LOADER_LABELS[entry.loader]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : activeLoaderInfo ? (
              <Badge variant="secondary" className="w-fit">
                {LOADER_LABELS[activeLoaderInfo.loader]}
              </Badge>
            ) : null}

            {provider ? (
              <Tabs
                value={provider}
                onValueChange={(value) =>
                  setActiveProvider(value as ResourceProvider)
                }
              >
                <TabsList className="flex h-auto flex-wrap justify-start">
                  {providers.map((entry) => (
                    <TabsTrigger key={entry} value={entry}>
                      {PROVIDER_LABELS[entry]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}

            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                runSearch();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder={
                    activeLoaderInfo
                      ? t(
                          "servers-management:modPluginBrowser.searchPlaceholderWithLoader",
                          { loader: LOADER_LABELS[activeLoaderInfo.loader] },
                        )
                      : t(
                          "servers-management:modPluginBrowser.searchPlaceholder",
                        )
                  }
                />
              </div>
              <Button type="submit" disabled={isPending || !provider}>
                <Search data-icon="inline-start" />
                {t("common:actions.search")}
              </Button>
            </form>

            {gameVersion ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="compatible-only"
                  checked={compatibleOnly}
                  onCheckedChange={setCompatibleOnly}
                />
                <Label
                  htmlFor="compatible-only"
                  className="text-sm font-normal text-muted-foreground"
                >
                  {t(
                    "servers-management:modPluginBrowser.compatibleOnlyLabel",
                    { gameVersion },
                  )}
                </Label>
              </div>
            ) : null}
          </CardHeader>

          <CardContent>
            <div className="flex flex-col gap-2">
              {isPending && projects.length === 0
                ? Array.from({ length: 8 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 rounded-md" />
                  ))
                : null}

              {!isPending && projects.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                  {t("servers-management:modPluginBrowser.noResultsFound")}
                </div>
              ) : null}

              {projects.map((project) => {
                const isSelected =
                  selectedProject?.id === project.id &&
                  selectedProject?.provider === project.provider;
                const entry = installedByProject.get(
                  installKey(project.provider, project.id),
                );

                return (
                  <button
                    key={`${project.provider}:${project.id}`}
                    type="button"
                    onClick={() => setSelectedProject(project)}
                    className={cn(
                      "flex min-h-20 w-full gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/60",
                      isSelected && "border-primary bg-muted",
                    )}
                  >
                    <Avatar className="size-11 rounded-md">
                      <AvatarImage src={project.icon_url ?? undefined} />
                      <AvatarFallback className="rounded-md">
                        {getInitials(project.title)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {project.title}
                        </span>
                        {project.categories.slice(0, 2).map((category) => (
                          <Badge key={category} variant="outline">
                            {category}
                          </Badge>
                        ))}
                        {entry ? (
                          <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                            <CheckCircle2 className="size-3" />
                            {t(
                              "servers-management:modPluginBrowser.badges.installed",
                            )}
                          </Badge>
                        ) : null}
                        {!project.downloadable ? (
                          <Badge variant="outline">
                            {t(
                              "servers-management:modPluginBrowser.badges.manualDownload",
                            )}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {project.description}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {project.author ? `${project.author} · ` : ""}
                        {t(
                          "servers-management:modPluginBrowser.downloadsLabel",
                          { count: formatCount(project.downloads) },
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>
              {selectedProject?.title ??
                t(
                  "servers-management:modPluginBrowser.selectResourceFallback",
                )}
            </CardTitle>
            <CardDescription>
              {selectedProject
                ? selectedProject.description
                : t(
                    "servers-management:modPluginBrowser.chooseProjectHint",
                  )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {selectedProject ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {PROVIDER_LABELS[selectedProject.provider]}
                  </Badge>
                  <Badge variant="outline">
                    {t(
                      "servers-management:modPluginBrowser.downloadsLabel",
                      { count: formatCount(selectedProject.downloads) },
                    )}
                  </Badge>
                  <Badge variant="outline">
                    {t("servers-management:modPluginBrowser.followsLabel", {
                      count: formatCount(selectedProject.follows),
                    })}
                  </Badge>
                  {selectedProject.page_url ? (
                    <a
                      href={selectedProject.page_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      {t(
                        "servers-management:modPluginBrowser.viewOnProviderLink",
                        {
                          provider:
                            PROVIDER_LABELS[selectedProject.provider],
                        },
                      )}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <Label htmlFor="resource-version">
                    {t("servers-management:modPluginBrowser.versionLabel")}
                  </Label>
                  <Select
                    value={selectedVersionId}
                    onValueChange={setSelectedVersionId}
                    disabled={versions.length === 0}
                  >
                    <SelectTrigger id="resource-version" className="w-full">
                      <SelectValue
                        placeholder={t(
                          "servers-management:modPluginBrowser.noCompatibleVersions",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          {version.name}
                          {version.version_number !== version.name
                            ? ` · ${version.version_number}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedVersion ? (
                  <div className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {selectedVersion.version_number}
                      </span>
                      <Badge variant="outline">
                        {selectedVersion.version_type}
                      </Badge>
                      {selectedVersion.published_at ? (
                        <Badge variant="outline">
                          {formatDate(selectedVersion.published_at)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-col gap-1 text-muted-foreground">
                      <span>
                        {t(
                          "servers-management:modPluginBrowser.minecraftVersionsPrefix",
                        )}
                        {selectedVersion.game_versions.slice(0, 5).join(", ") ||
                          t("common:status.unknown")}
                        {selectedVersion.game_versions.length > 5 ? ", ..." : ""}
                      </span>
                      <span>
                        {t(
                          "servers-management:modPluginBrowser.fileLabelPrefix",
                        )}
                        {selectedVersion.file_name ??
                          t(
                            "servers-management:modPluginBrowser.fileUnavailable",
                          )}
                      </span>
                    </div>
                  </div>
                ) : null}

                {selectedInstall ? (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    {t(
                      "servers-management:modPluginBrowser.installedFilePrefix",
                    )}
                    {selectedInstall.file_name}
                  </div>
                ) : null}

                <Button
                  onClick={
                    kind === "modpack"
                      ? () => setModpackConfirmOpen(true)
                      : handleInstall
                  }
                  disabled={
                    !canWriteFiles ||
                    !selectedVersion ||
                    selectedVersion.downloadable === false ||
                    modpackJob?.state === "running"
                  }
                >
                  {selectedInstall ? (
                    <RefreshCw data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {selectedInstall
                    ? t(
                        "servers-management:modPluginBrowser.switchVersionButton",
                      )
                    : t("servers-management:modPluginBrowser.installButton")}
                </Button>

                {selectedVersion?.downloadable === false ? (
                  <p className="text-sm text-muted-foreground">
                    {selectedProject.provider === "spigot"
                      ? t(
                          "servers-management:modPluginBrowser.manualDownloadHints.spigot",
                        )
                      : t(
                          "servers-management:modPluginBrowser.manualDownloadHints.generic",
                        )}
                  </p>
                ) : null}
                {!canWriteFiles ? (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "servers-management:modPluginBrowser.noWritePermissionHint",
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                {t("servers-management:modPluginBrowser.searchOrSelectHint")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {installedModpack ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Boxes className="size-5" />
              {installedModpack.title}
              <Badge variant="secondary">
                {PROVIDER_LABELS[installedModpack.provider]}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t("servers-management:modPluginBrowser.installedModpack.prefix")}
              {installedModpack.mods.length > 0
                ? t(
                    "servers-management:modPluginBrowser.installedModpack.modsCount",
                    { count: installedModpack.mods.length },
                  )
                : t(
                    "servers-management:modPluginBrowser.installedModpack.noModsFound",
                  )}
              {installedModpack.other_files > 0
                ? t(
                    "servers-management:modPluginBrowser.installedModpack.andConfigFiles",
                    { count: installedModpack.other_files },
                  )
                : ""}
              {t("servers-management:modPluginBrowser.installedModpack.suffix")}
            </CardDescription>
          </CardHeader>
          {installedModpack.mods.length > 0 ? (
            <CardContent className="flex flex-col gap-2">
              {installedModpack.mods.map((entry) => (
                <div
                  key={`${entry.resource_type}:${entry.file_name}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <span
                    className={cn(
                      "truncate font-medium",
                      !entry.enabled && "text-muted-foreground",
                    )}
                  >
                    {entry.file_name}
                  </span>
                  <span className="flex items-center gap-2">
                    {!entry.enabled ? (
                      <Badge variant="outline">
                        {t("common:status.disabled")}
                      </Badge>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canWriteFiles}
                      onClick={() =>
                        handleSetState(
                          entry.resource_type,
                          entry.file_name,
                          entry.file_name,
                          !entry.enabled,
                        )
                      }
                    >
                      {entry.enabled ? (
                        <PowerOff data-icon="inline-start" />
                      ) : (
                        <Power data-icon="inline-start" />
                      )}
                      {entry.enabled
                        ? t("servers-management:modPluginBrowser.actions.disable")
                        : t("servers-management:modPluginBrowser.actions.enable")}
                    </Button>
                  </span>
                </div>
              ))}
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {modpackJob ? (
        <Card
          className={cn(
            modpackJob.state === "failed" && "border-destructive/40 bg-destructive/5",
          )}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="size-5" />
              {modpackJob.pack ??
                t(
                  "servers-management:modPluginBrowser.modpackJob.fallbackTitle",
                )}
              <Badge variant="outline">{modpackJob.step}</Badge>
            </CardTitle>
            <CardDescription>
              {modpackJob.state === "running"
                ? `${t("servers-management:modPluginBrowser.modpackJob.runningBase")}${
                    modpackJob.total > 0
                      ? t(
                          "servers-management:modPluginBrowser.modpackJob.runningProgress",
                          { done: modpackJob.done, total: modpackJob.total },
                        )
                      : ""
                  }${t("servers-management:modPluginBrowser.modpackJob.runningSuffix")}`
                : modpackJob.state === "failed"
                  ? (modpackJob.error ??
                    t(
                      "servers-management:modPluginBrowser.modpackJob.failedDefault",
                    ))
                  : t(
                      "servers-management:modPluginBrowser.modpackJob.installedCount",
                      { count: modpackJob.done },
                    )}
            </CardDescription>
          </CardHeader>
          {modpackJob.total > 0 ? (
            <CardContent className="flex flex-col gap-3">
              <Progress
                value={Math.round((modpackJob.done / modpackJob.total) * 100)}
              />
              {modpackJob.failures.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "servers-management:modPluginBrowser.modpackJob.failuresMessage",
                    {
                      count: modpackJob.failures.length,
                      list:
                        modpackJob.failures.slice(0, 5).join(", ") +
                        (modpackJob.failures.length > 5 ? ", ..." : ""),
                    },
                  )}
                </p>
              ) : null}
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <AlertDialog
        open={modpackConfirmOpen}
        onOpenChange={setModpackConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers-management:modPluginBrowser.modpackConfirm.title", {
                title:
                  selectedProject?.title ??
                  t(
                    "servers-management:modPluginBrowser.modpackConfirm.fallbackTitle",
                  ),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "servers-management:modPluginBrowser.modpackConfirm.description",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Switch
                id="modpack-backup"
                checked={modpackBackup}
                disabled={!backupAvailable}
                onCheckedChange={setModpackBackup}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="modpack-backup">
                  {t(
                    "servers-management:modPluginBrowser.modpackConfirm.backupLabel",
                  )}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {backupAvailable
                    ? t(
                        "servers-management:modPluginBrowser.modpackConfirm.backupAvailableHint",
                      )
                    : t(
                        "servers-management:modPluginBrowser.modpackConfirm.backupUnavailableHint",
                      )}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Switch
                id="modpack-wipe"
                checked={modpackWipe}
                onCheckedChange={setModpackWipe}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="modpack-wipe">
                  {t(
                    "servers-management:modPluginBrowser.modpackConfirm.wipeLabel",
                  )}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t(
                    "servers-management:modPluginBrowser.modpackConfirm.wipeHint",
                  )}
                </p>
              </div>
            </div>

            {modpackWipe && !modpackBackup ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {t(
                  "servers-management:modPluginBrowser.modpackConfirm.wipeWarning",
                )}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleInstallModpack}>
              {t("servers-management:modPluginBrowser.installButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              {t("servers-management:modPluginBrowser.installedSection.title")}
              {updates.length > 0 ? (
                <Badge className="gap-1 border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
                  <ArrowUpCircle className="size-3" />
                  {t(
                    "servers-management:modPluginBrowser.installedSection.updatesBadge",
                    { count: updates.length },
                  )}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
            {installed.length === 0
              ? t(
                  "servers-management:modPluginBrowser.installedSection.emptyState",
                )
              : t(
                  "servers-management:modPluginBrowser.installedSection.countDescription",
                  { count: installed.length },
                )}
            </CardDescription>
          </div>
          <span className="flex flex-wrap items-center gap-3">
            {installed.length > 0 ? (
              <span className="flex items-center gap-2">
                <Switch
                  id="allow-prerelease"
                  checked={allowPrerelease}
                  onCheckedChange={setAllowPrerelease}
                />
                <Label
                  htmlFor="allow-prerelease"
                  className="text-sm font-normal text-muted-foreground"
                >
                  {t(
                    "servers-management:modPluginBrowser.installedSection.includeBetaLabel",
                  )}
                </Label>
              </span>
            ) : null}
            {updates.length > 0 ? (
              <Button
                size="sm"
                disabled={!canWriteFiles}
                onClick={handleUpdateAll}
              >
                <ArrowUpCircle data-icon="inline-start" />
                {t(
                  "servers-management:modPluginBrowser.installedSection.updateAllButton",
                )}
              </Button>
            ) : null}
          </span>
        </CardHeader>
        {installed.length > 0 ? (
          <CardContent className="flex flex-col gap-2">
            {installed.map((entry) => (
              <div
                key={installKey(entry.provider, entry.project)}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <span className={cn(!entry.enabled && "text-muted-foreground")}>
                      {entry.title}
                    </span>
                    <Badge variant="secondary">
                      {PROVIDER_LABELS[entry.provider]}
                    </Badge>
                    {!entry.enabled ? (
                      <Badge variant="outline">
                        {t("common:status.disabled")}
                      </Badge>
                    ) : null}
                    {updateByProject.has(
                      installKey(entry.provider, entry.project),
                    ) ? (
                      <Badge className="gap-1 border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
                        <ArrowUpCircle className="size-3" />
                        {
                          updateByProject.get(
                            installKey(entry.provider, entry.project),
                          )?.latest_version_number
                        }
                      </Badge>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {entry.file_name}
                    {!entry.enabled ? ".disabled" : ""}
                  </span>
                </div>
                <span className="flex items-center gap-2">
                  {updateByProject.has(
                    installKey(entry.provider, entry.project),
                  ) ? (
                    <Button
                      size="sm"
                      disabled={
                        !canWriteFiles ||
                        updateByProject.get(
                          installKey(entry.provider, entry.project),
                        )?.downloadable === false
                      }
                      onClick={() => handleUpdate(entry)}
                    >
                      <ArrowUpCircle data-icon="inline-start" />
                      {t("common:actions.update")}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canWriteFiles}
                    onClick={() =>
                      handleSetState(
                        entry.resource_type,
                        entry.file_name,
                        entry.title,
                        !entry.enabled,
                      )
                    }
                  >
                    {entry.enabled ? (
                      <PowerOff data-icon="inline-start" />
                    ) : (
                      <Power data-icon="inline-start" />
                    )}
                    {entry.enabled
                      ? t("servers-management:modPluginBrowser.actions.disable")
                      : t("servers-management:modPluginBrowser.actions.enable")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canWriteFiles}
                    onClick={() => handleUninstall(entry)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t("common:actions.remove")}
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        ) : null}
      </Card>

      {unmanaged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileQuestion className="size-5" />
              {t("servers-management:modPluginBrowser.unmanagedSection.title")}
            </CardTitle>
            <CardDescription>
              {t(
                "servers-management:modPluginBrowser.unmanagedSection.description",
                { count: unmanaged.length },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {unmanaged.map((entry) => (
              <div
                key={`${entry.resource_type}:${entry.file_name}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3"
              >
                <span
                  className={cn(
                    "truncate font-medium",
                    !entry.enabled && "text-muted-foreground",
                  )}
                >
                  {entry.file_name}
                </span>
                <span className="flex items-center gap-2">
                  {!entry.enabled ? (
                    <Badge variant="outline">
                      {t("common:status.disabled")}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">
                    {RESOURCE_TYPE_LABELS[entry.resource_type] ??
                      entry.resource_type}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatSize(entry.size)}
                  </span>
                  {entry.resource_type === "data_pack" ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canWriteFiles}
                      onClick={() =>
                        handleSetState(
                          entry.resource_type,
                          entry.file_name,
                          entry.file_name,
                          !entry.enabled,
                        )
                      }
                    >
                      {entry.enabled ? (
                        <PowerOff data-icon="inline-start" />
                      ) : (
                        <Power data-icon="inline-start" />
                      )}
                      {entry.enabled
                        ? t(
                            "servers-management:modPluginBrowser.actions.disable",
                          )
                        : t(
                            "servers-management:modPluginBrowser.actions.enable",
                          )}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {unreadable.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5" />
              {t(
                "servers-management:modPluginBrowser.unreadableSection.title",
              )}
            </CardTitle>
            <CardDescription>
              {t(
                "servers-management:modPluginBrowser.unreadableSection.description",
                {
                  types: unreadable
                    .map((type) => RESOURCE_TYPE_LABELS[type] ?? type)
                    .join(" and "),
                },
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
