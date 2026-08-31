"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import type { AppProject } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { usePathname } from "@/lib/navigation";
import { useRouter } from "@/lib/navigation";

export function SwitcherItem({
  project,
  activeProjectId,
}: {
  project: AppProject;
  activeProjectId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const pathAfterSlug = pathname.split("/").slice(2).join("/");

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault();
        if (activeProjectId === project.id) return;
        const nextPath = pathAfterSlug
          ? `/${project.slug}/${pathAfterSlug}`
          : `/${project.slug}`;
        router.replace(nextPath);
      }}
      className={cn(
        "gap-2 p-2 cursor-pointer",
        activeProjectId === project.id && "bg-accent",
      )}
    >
      <ProjectAvatar
        projectId={project.id}
        projectName={project.name}
        className="size-5"
      />
      <div className="flex flex-col">
        <TextEllipsis width={140}>{project.name}</TextEllipsis>
      </div>
      {activeProjectId === project.id && (
        <Check className="ml-auto size-4 text-primary" />
      )}
    </DropdownMenuItem>
  );
}
