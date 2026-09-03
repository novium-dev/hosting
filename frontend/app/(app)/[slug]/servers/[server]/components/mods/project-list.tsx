import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResourceProject } from "@/lib/mod-browser/types";
import { ProjectIcon, ProjectTitleLink, formatCount } from "./shared";

type ProjectListProps = {
  projects: ResourceProject[];
  isLoading: boolean;
  emptyLabel: string;
  action: (project: ResourceProject) => ReactNode;
  status?: (project: ResourceProject) => ReactNode;
};

export function ProjectList({
  projects,
  isLoading,
  emptyLabel,
  action,
  status,
}: ProjectListProps) {
  const { t } = useTranslation();

  if (isLoading && projects.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[4.5rem] rounded-md" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <div
          key={`${project.provider}:${project.id}`}
          className="flex flex-wrap items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
        >
          <ProjectIcon
            src={project.icon_url}
            title={project.title}
            className="size-11"
          />

          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <ProjectTitleLink
                href={project.page_url}
                title={project.title}
                className="font-medium"
              />
              {status?.(project)}
              {project.downloadable ? null : (
                <Badge variant="outline">
                  {t("servers-management:mods.badges.manualDownload")}
                </Badge>
              )}
            </span>
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {project.description}
            </span>
            <span className="text-xs text-muted-foreground">
              {project.author ? `${project.author} · ` : ""}
              {t("servers-management:mods.downloadsLabel", {
                downloads: formatCount(project.downloads),
              })}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {action(project)}
          </div>
        </div>
      ))}
    </div>
  );
}
