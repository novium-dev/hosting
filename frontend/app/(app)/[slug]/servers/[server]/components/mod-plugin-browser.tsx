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

import {
  getResourceContextAction,
  installResourceVersionAction,
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
  const [activeLoader, setActiveLoader] = useState<ResourceLoader | null>(null);
  const [activeProvider, setActiveProvider] = useState<ResourceProvider | null>(
    null,
  );
  const [kind, setKind] = useState<ResourceKind>("resource");
  const [query, setQuery] = useState("");
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [allowPrerelease, setAllowPrerelease] = useState(false);
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

    toast.success(`Installed ${selectedProject.title}`);
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

    toast.success(`${enabled ? "Enabled" : "Disabled"} ${label}`);
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

    toast.success(`Updated ${entry.title}`);
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  const handleUpdateAll = async () => {
    const result = await updateAllResourcesAction({ serverId, allowPrerelease });

    if (result.serverError || !result.data) {
      toast.error(result.serverError ?? "Failed to update resources");
      return;
    }

    const updated = result.data.filter((entry) => entry.version);
    const failed = result.data.filter((entry) => entry.error);

    if (updated.length > 0) {
      toast.success(
        `Updated ${updated.length} resource${updated.length === 1 ? "" : "s"}`,
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

    toast.success(`Removed ${entry.title}`);
    await Promise.all([refreshInstalled(), refreshUpdates()]);
  };

  if (context && loaders.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Mod browser unavailable</CardTitle>
          <CardDescription>
            This server template does not expose a supported Minecraft mod or
            plugin feature.
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
                Mods and Plugins
              </CardTitle>
              <CardDescription>
                {kind === "modpack"
                  ? "Browse Modrinth and CurseForge modpacks compatible with this server."
                  : "Browse Modrinth, CurseForge, Hangar and SpigotMC resources compatible with this server."}
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
                    Mods
                  </TabsTrigger>
                  <TabsTrigger value="modpack">
                    <Boxes className="mr-1 size-4" />
                    Modpacks
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
                      ? `Search ${LOADER_LABELS[activeLoaderInfo.loader]}`
                      : "Search"
                  }
                />
              </div>
              <Button type="submit" disabled={isPending || !provider}>
                <Search data-icon="inline-start" />
                Search
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
                  Only show resources for Minecraft {gameVersion}
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
                  No compatible resources found.
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
                            Installed
                          </Badge>
                        ) : null}
                        {!project.downloadable ? (
                          <Badge variant="outline">Manual download</Badge>
                        ) : null}
                      </span>
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {project.description}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {project.author ? `${project.author} · ` : ""}
                        {formatCount(project.downloads)} downloads
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
            <CardTitle>{selectedProject?.title ?? "Select a resource"}</CardTitle>
            <CardDescription>
              {selectedProject
                ? selectedProject.description
                : "Choose a project to view its versions."}
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
                    {formatCount(selectedProject.downloads)} downloads
                  </Badge>
                  <Badge variant="outline">
                    {formatCount(selectedProject.follows)} follows
                  </Badge>
                  {selectedProject.page_url ? (
                    <a
                      href={selectedProject.page_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      View on {PROVIDER_LABELS[selectedProject.provider]}
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <Label htmlFor="resource-version">Version</Label>
                  <Select
                    value={selectedVersionId}
                    onValueChange={setSelectedVersionId}
                    disabled={versions.length === 0}
                  >
                    <SelectTrigger id="resource-version" className="w-full">
                      <SelectValue placeholder="No compatible versions" />
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
                        Minecraft:{" "}
                        {selectedVersion.game_versions.slice(0, 5).join(", ") ||
                          "Unknown"}
                        {selectedVersion.game_versions.length > 5 ? ", ..." : ""}
                      </span>
                      <span>
                        File: {selectedVersion.file_name ?? "Unavailable"}
                      </span>
                    </div>
                  </div>
                ) : null}

                {selectedInstall ? (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    Installed: {selectedInstall.file_name}
                  </div>
                ) : null}

                <Button
                  onClick={handleInstall}
                  disabled={
                    !canWriteFiles ||
                    !selectedVersion ||
                    selectedVersion.downloadable === false ||
                    kind === "modpack"
                  }
                >
                  {selectedInstall ? (
                    <RefreshCw data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {selectedInstall ? "Switch Version" : "Install"}
                </Button>

                {kind === "modpack" ? (
                  <p className="text-sm text-muted-foreground">
                    Modpack installation is not available yet — a pack has to be
                    unpacked and its mods fetched individually. Browsing and
                    version listing work today.
                  </p>
                ) : null}

                {selectedVersion?.downloadable === false ? (
                  <p className="text-sm text-muted-foreground">
                    {selectedProject.provider === "spigot"
                      ? "SpigotMC does not allow automated downloads. Download the jar from its page and upload it under Files."
                      : "This version is hosted outside the provider and has to be downloaded and uploaded manually."}
                  </p>
                ) : null}
                {!canWriteFiles ? (
                  <p className="text-sm text-muted-foreground">
                    You need file write permission to install resources.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Search or select a resource from the list.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              Installed
              {updates.length > 0 ? (
                <Badge className="gap-1 border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
                  <ArrowUpCircle className="size-3" />
                  {updates.length} update{updates.length === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
            {installed.length === 0
              ? "Nothing installed through the browser yet."
              : `${installed.length} resource${installed.length === 1 ? "" : "s"} installed on this server.`}
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
                  Include beta versions
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
                Update all
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
                      <Badge variant="outline">Disabled</Badge>
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
                      Update
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
                    {entry.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canWriteFiles}
                    onClick={() => handleUninstall(entry)}
                  >
                    <Trash2 data-icon="inline-start" />
                    Remove
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
              Not installed through the browser
            </CardTitle>
            <CardDescription>
              {unmanaged.length} file
              {unmanaged.length === 1 ? "" : "s"} on this server that no record
              points at — uploaded over SFTP or in the file manager, or replaced
              by hand. You can still enable or disable them here; deleting them
              is done under Files.
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
                    <Badge variant="outline">Disabled</Badge>
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
                      {entry.enabled ? "Disable" : "Enable"}
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
              Could not read every directory
            </CardTitle>
            <CardDescription>
              The{" "}
              {unreadable
                .map((type) => RESOURCE_TYPE_LABELS[type] ?? type)
                .join(" and ")}{" "}
              directory could not be listed, so the lists above may be
              incomplete. Nothing was removed from the records.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
