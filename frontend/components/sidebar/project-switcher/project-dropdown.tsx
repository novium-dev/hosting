"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import type { AppProject } from "@/lib/auth";
import { ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProject } from "@/hooks/use-project";
import { useParams } from "@/lib/navigation";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { CreateProjectModal } from "./create-project";
import { SwitcherItem } from "./switcher-item";

export function ProjectDropdown({ projects }: { projects: AppProject[] }) {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useTranslation();
  const { canCreateProject } = useInstancePolicy();
  const { data: currentProject } = useProject(slug);

  const activeProject =
    projects.find((project) => project.slug === slug) ?? currentProject;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg">
          <ProjectAvatar
            projectId={activeProject?.id ?? ""}
            projectName={activeProject?.name ?? ""}
          />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">
              {activeProject?.name ?? ""}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {activeProject?.slug ?? slug}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 rounded-lg"
        align="start"
        side="right"
        sideOffset={8}
      >
        <DropdownMenuItem className="flex items-center gap-2">
          <ProjectAvatar
            projectId={activeProject?.id ?? ""}
            projectName={activeProject?.name ?? ""}
          />
          <span className="truncate font-semibold">
            {activeProject?.name ?? ""}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("navigation:projectSwitcher.switchProject")}
        </DropdownMenuLabel>
        {projects?.map((project) => (
          <SwitcherItem
            key={project.id}
            project={project}
            activeProjectId={activeProject?.id ?? ""}
          />
        ))}
        {canCreateProject && (
          <>
            <DropdownMenuSeparator />
            <CreateProjectModal />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
