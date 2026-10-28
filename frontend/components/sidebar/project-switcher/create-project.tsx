"use client";

import { AdminBypassAlert } from "@/components/admin-bypass-alert";
import { CreateProjectForm } from "@/components/create-project-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { Plus, ShieldAlert } from "lucide-react";
import { useRouter } from "@/lib/navigation";
import { useTranslation } from "react-i18next";

export function CreateProjectItem({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation();
  const { projectCreationBypassed } = useInstancePolicy();

  return (
    <DropdownMenuItem className="gap-2 p-2 cursor-pointer" onClick={onSelect}>
      <div className="flex size-6 items-center justify-center rounded-md border">
        <Plus className="size-4" />
      </div>
      <span className="font-medium">
        {t("navigation:projectSwitcher.createProject")}
      </span>
      {projectCreationBypassed && (
        <Tooltip>
          <TooltipTrigger
            render={
              <ShieldAlert className="ml-auto size-4 text-muted-foreground" />
            }
          />
          <TooltipContent>
            {t("common:policy.projectCreationAdminOnly")}
          </TooltipContent>
        </Tooltip>
      )}
    </DropdownMenuItem>
  );
}

export function CreateProjectModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { projectCreationBypassed } = useInstancePolicy();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("navigation:projectSwitcher.createProject")}
          </DialogTitle>
          <DialogDescription>
            {t("navigation:projectSwitcher.createProjectDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="shadow-xs border-none">
          <div className="space-y-6 p-0">
            {projectCreationBypassed && (
              <AdminBypassAlert
                description={t("common:policy.projectCreationAdminOnly")}
              />
            )}
            <CreateProjectForm
              onSuccess={({ slug }) => {
                onOpenChange(false);
                router.push(`/${slug}`);
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
