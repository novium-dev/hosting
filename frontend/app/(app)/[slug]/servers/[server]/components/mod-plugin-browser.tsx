"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useAction } from "next-safe-action/hooks";
import {
  CheckCircle2,
  Download,
  PackageSearch,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import {
  installResourceVersionAction,
  listResourceVersionsAction,
  searchResourceProjectsAction,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  MinecraftResourceLoader,
  MinecraftResourceCapability,
  ResourceProject,
  ResourceVersion,
} from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";

type ModPluginBrowserProps = {
  serverId: string;
  slug: string;
  capabilities: MinecraftResourceCapability[];
  installedFilesByPath: Record<string, string[]>;
  canWriteFiles: boolean;
};

type InstalledState = {
  installed: boolean;
  versionId: string | null;
  fileName: string | null;
};

function InstalledBadge() {
  return (
    <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <CheckCircle2 className="size-3" />
      Installed
    </Badge>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
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

function getInstalledState(
  versions: ResourceVersion[],
  installedFileNames: string[],
): InstalledState {
  const installed = new Set(installedFileNames);

  for (const version of versions) {
    const fileName = version.fileNames.find((name) => installed.has(name));
    if (fileName) {
      return {
        installed: true,
        versionId: version.id,
        fileName,
      };
    }
  }

  return {
    installed: false,
    versionId: null,
    fileName: null,
  };
}

export function ModPluginBrowser({
  serverId,
  slug,
  capabilities,
  installedFilesByPath,
  canWriteFiles,
}: ModPluginBrowserProps) {
  const [activeLoader, setActiveLoader] = useState<MinecraftResourceLoader>(
    capabilities[0]?.loader ?? "fabric",
  );
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ResourceProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ResourceProject | null>(
    null,
  );
  const [versions, setVersions] = useState<ResourceVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [projectInstallStates, setProjectInstallStates] = useState<
    Record<string, InstalledState>
  >({});
  const [isPending, startTransition] = useTransition();

  const searchAction = useAction(searchResourceProjectsAction);
  const versionsAction = useAction(listResourceVersionsAction);
  const installAction = useAction(installResourceVersionAction, {
    onSuccess: () => {
      toast.success("Resource installed");
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Failed to install resource");
    },
  });

  const activeCapability = useMemo(
    () =>
      capabilities.find((capability) => capability.loader === activeLoader) ??
      capabilities[0],
    [activeLoader, capabilities],
  );

  const installedFileNames = useMemo(
    () => installedFilesByPath[activeCapability?.path ?? "/mods"] ?? [],
    [activeCapability?.path, installedFilesByPath],
  );

  const installedState = useMemo(
    () => getInstalledState(versions, installedFileNames),
    [installedFileNames, versions],
  );

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [selectedVersionId, versions],
  );
  const projectIdsKey = useMemo(
    () => projects.map((project) => project.id).join(","),
    [projects],
  );

  const selectedProjectInstallState = selectedProject
    ? (projectInstallStates[selectedProject.id] ?? installedState)
    : installedState;

  const runSearch = (nextQuery = query) => {
    if (!activeCapability) {
      return;
    }

    startTransition(async () => {
      const result = await searchAction.executeAsync({
        provider: "modrinth",
        query: nextQuery,
        loader: activeCapability.loader,
      });

      if (result?.data) {
        setProjects(result.data);
        setSelectedProject(result.data[0] ?? null);
        setProjectInstallStates({});
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    });
  };

  useEffect(() => {
    runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCapability?.loader]);

  useEffect(() => {
    if (!selectedProject || !activeCapability) {
      setVersions([]);
      setSelectedVersionId("");
      return;
    }

    let ignore = false;

    startTransition(async () => {
      const result = await versionsAction.executeAsync({
        provider: "modrinth",
        projectId: selectedProject.id,
        loader: activeCapability.loader,
      });

      if (ignore) {
        return;
      }

      if (result?.data) {
        setVersions(result.data);
        setSelectedVersionId(result.data[0]?.id ?? "");
      } else if (result?.serverError) {
        toast.error(result.serverError);
        setVersions([]);
        setSelectedVersionId("");
      }
    });

    return () => {
      ignore = true;
    };
    // next-safe-action updates the action object as requests resolve. Keeping
    // this effect keyed to stable resource identity prevents repeated POSTs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCapability?.loader, selectedProject?.id]);

  useEffect(() => {
    if (!activeCapability || projects.length === 0) {
      setProjectInstallStates({});
      return;
    }

    let ignore = false;

    const loadInstallStates = async () => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const result = await versionsAction.executeAsync({
            provider: "modrinth",
            projectId: project.id,
            loader: activeCapability.loader,
          });

          return [
            project.id,
            result?.data
              ? getInstalledState(result.data, installedFileNames)
              : {
                  installed: false,
                  versionId: null,
                  fileName: null,
                },
          ] as const;
        }),
      );

      if (!ignore) {
        setProjectInstallStates(Object.fromEntries(entries));
      }
    };

    void loadInstallStates();

    return () => {
      ignore = true;
    };
    // next-safe-action mutates action state; key this fetch to stable search
    // results and file data only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCapability?.loader, installedFileNames, projectIdsKey]);

  const handleInstall = async () => {
    if (!activeCapability || !selectedVersion) {
      return;
    }

    await installAction.executeAsync({
      serverId,
      slug,
      provider: "modrinth",
      resourceType: activeCapability.resourceType,
      versionId: selectedVersion.id,
    });
  };

  if (!activeCapability) {
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
      <Card>
        <CardHeader className="gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PackageSearch className="size-5" />
              Mods and Plugins
            </CardTitle>
            <CardDescription>
              Browse Modrinth resources compatible with this server template.
            </CardDescription>
          </div>

          {capabilities.length > 1 ? (
            <Tabs
              value={activeCapability.loader}
              onValueChange={(value) =>
                setActiveLoader(value as MinecraftResourceLoader)
              }
            >
              <TabsList className="flex h-auto flex-wrap justify-start">
                {capabilities.map((capability) => (
                  <TabsTrigger key={capability.loader} value={capability.loader}>
                    {capability.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <Badge variant="secondary" className="w-fit">
              {activeCapability.label}
            </Badge>
          )}

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
                placeholder={`Search ${activeCapability.label}`}
              />
            </div>
            <Button type="submit" disabled={isPending}>
              <Search data-icon="inline-start" />
              Search
            </Button>
          </form>
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
              const isSelected = selectedProject?.id === project.id;
              const projectInstalled =
                projectInstallStates[project.id]?.installed ?? false;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProject(project)}
                  className={cn(
                    "flex min-h-20 w-full gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/60",
                    isSelected && "border-primary bg-muted",
                  )}
                >
                  <Avatar className="size-11 rounded-md">
                    <AvatarImage src={project.iconUrl ?? undefined} />
                    <AvatarFallback className="rounded-md">
                      {getInitials(project.title)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {project.title}
                      </span>
                      {project.categories.slice(0, 2).map((category) => (
                        <Badge key={category} variant="outline">
                          {category}
                        </Badge>
                      ))}
                      {projectInstalled ? <InstalledBadge /> : null}
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {project.description}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {project.author} · {formatCount(project.downloads)}{" "}
                      downloads
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
              : "Choose a Modrinth project to view versions."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {selectedProject ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Modrinth</Badge>
                <Badge variant="outline">
                  {formatCount(selectedProject.downloads)} downloads
                </Badge>
                <Badge variant="outline">
                  {formatCount(selectedProject.follows)} follows
                </Badge>
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
                        {version.name} · {version.versionNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedVersion ? (
                <div className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {selectedVersion.versionNumber}
                    </span>
                    <Badge variant="outline">{selectedVersion.versionType}</Badge>
                    <Badge variant="outline">
                      {formatDate(selectedVersion.publishedAt)}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-col gap-1 text-muted-foreground">
                    <span>
                      Minecraft:{" "}
                      {selectedVersion.gameVersions.slice(0, 5).join(", ")}
                      {selectedVersion.gameVersions.length > 5 ? ", ..." : ""}
                    </span>
                    <span>
                      File: {selectedVersion.primaryFileName ?? "Unavailable"}
                    </span>
                  </div>
                </div>
              ) : null}

              {selectedProjectInstallState.installed ? (
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Installed file detected: {selectedProjectInstallState.fileName}
                </div>
              ) : null}

              <Button
                onClick={handleInstall}
                disabled={
                  !canWriteFiles ||
                  !selectedVersion ||
                  installAction.isExecuting
                }
              >
                {selectedProjectInstallState.installed ? (
                  <RefreshCw data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {selectedProjectInstallState.installed
                  ? "Switch Version"
                  : "Install"}
              </Button>
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
  );
}
