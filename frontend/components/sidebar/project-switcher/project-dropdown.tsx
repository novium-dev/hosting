"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import type { AppProject } from "@/lib/auth";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "@/lib/navigation";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { CreateProjectModal } from "./create-project";
import { SwitcherItem } from "./switcher-item";

export function ProjectDropdown({
  projects,
}: {
  projects: AppProject[];
}) {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useTranslation();
  const { canCreateProject } = useInstancePolicy();

  const activeProject = projects.find((project) => project.slug === slug);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <ProjectAvatar
            projectId={activeProject?.id ?? ""}
            projectName={activeProject?.name ?? ""}
          />
          <span className="hidden max-w-40 truncate font-semibold md:block">
            <TextEllipsis width={140}>
              {activeProject?.name ?? ""}
            </TextEllipsis>
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 rounded-lg"
        align="start"
        side="bottom"
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
