"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import type { AppProject } from "@/lib/auth";
import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProject } from "@/hooks/use-project";
import { useParams } from "@/lib/navigation";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { CreateProjectItem, CreateProjectModal } from "./create-project";
import { SwitcherItem } from "./switcher-item";

export function ProjectDropdown({ projects }: { projects: AppProject[] }) {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useTranslation();
  const { canCreateProject } = useInstancePolicy();
  const { data: currentProject } = useProject(slug);
  const [createOpen, setCreateOpen] = useState(false);

  const activeProject =
    projects.find((project) => project.slug === slug) ?? currentProject;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuButton size="lg" className="h-10" />}
        >
          <ProjectAvatar
            projectId={activeProject?.id ?? ""}
            projectName={activeProject?.name ?? ""}
            logoUrl={activeProject?.logo_url}
            className="size-7"
          />
          <span className="flex-1 truncate text-left font-semibold group-data-[collapsible=icon]:hidden">
            {activeProject?.name ?? ""}
          </span>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
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
              logoUrl={activeProject?.logo_url}
            />
            <span className="truncate font-semibold">
              {activeProject?.name ?? ""}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
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
          </DropdownMenuGroup>
          {canCreateProject && (
            <>
              <DropdownMenuSeparator />
              <CreateProjectItem onSelect={() => setCreateOpen(true)} />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProjectModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
