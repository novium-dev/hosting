import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import {
  installResourceVersionAction,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROVIDER_LABELS,
  type ResourceLoader,
  type ResourceProject,
} from "@/lib/mod-browser/types";
import { ProjectIcon, formatCount, formatDate, versionLabel } from "./shared";

type ResourceInstallDialogProps = {
  serverId: string;
  project: ResourceProject | null;
  loader: ResourceLoader | null;
  gameVersion?: string;
  installedVersion?: string | null;
  canInstall: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
};

export function ResourceInstallDialog({
  serverId,
  project,
  loader,
  gameVersion,
  installedVersion,
  canInstall,
  onOpenChange,
  onInstalled,
}: ResourceInstallDialogProps) {
  const { t } = useTranslation();
  const [versionId, setVersionId] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);

  const { data: versions = [], isLoading } = useSWR(
    project && loader
      ? [
          "resource-versions",
          serverId,
          project.provider,
          project.id,
          loader,
          gameVersion ?? "",
        ]
      : null,
    async () => {
      if (!project || !loader) return [];
      const result = await listResourceVersionsAction({
        serverId,
        provider: project.provider,
        project: project.id,
        loader,
        kind: "resource",
        gameVersion,
      });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? [];
    },
  );

  useEffect(() => {
    setVersionId("");
  }, [project?.provider, project?.id]);

  useEffect(() => {
    if (versionId || versions.length === 0) return;
    setVersionId(versions[0].id);
  }, [versionId, versions]);

  const version = versions.find((entry) => entry.id === versionId) ?? null;

  const install = async () => {
    if (!project || !loader || !version) return;

    setIsInstalling(true);
    const result = await installResourceVersionAction({
      serverId,
      provider: project.provider,
      project: project.id,
      version: version.id,
      loader,
      title: project.title,
      pageUrl: project.page_url ?? undefined,
    });
    setIsInstalling(false);

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(
      t("servers-management:mods.toasts.installed", { title: project.title }),
    );
    onOpenChange(false);
    onInstalled();
  };

  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project?.title}</DialogTitle>
          <DialogDescription className="line-clamp-3">
            {project?.description}
          </DialogDescription>
        </DialogHeader>

        {project ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <ProjectIcon src={project.icon_url} title={project.title} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {PROVIDER_LABELS[project.provider]}
                </Badge>
                <Badge variant="outline">
                  {t("servers-management:mods.downloadsLabel", {
                    downloads: formatCount(project.downloads),
                  })}
                </Badge>
                {project.page_url ? (
                  <a
                    href={project.page_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {t("servers-management:mods.viewOnProvider", {
                      provider: PROVIDER_LABELS[project.provider],
                    })}
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="resource-version">
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
                onValueChange={(value) => setVersionId(value ?? "")}
                disabled={isLoading || versions.length === 0}
              >
                <SelectTrigger id="resource-version" className="w-full">
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
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {version ? (
                <p className="text-sm text-muted-foreground">
                  {[
                    version.version_type,
                    version.published_at
                      ? formatDate(version.published_at)
                      : null,
                    version.file_name,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>

            {version?.downloadable === false ? (
              <p className="text-sm text-muted-foreground">
                {project.provider === "spigot"
                  ? t("servers-management:mods.manualDownloadHints.spigot")
                  : t("servers-management:mods.manualDownloadHints.generic")}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => void install()}
            loading={isInstalling}
            disabled={
              !canInstall ||
              !version ||
              version.downloadable === false ||
              isInstalling
            }
          >
            <Download data-icon="inline-start" />
            {installedVersion
              ? t("servers-management:mods.switchVersionButton")
              : t("servers-management:mods.installButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
