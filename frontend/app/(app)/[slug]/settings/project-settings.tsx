"use client";

import { deleteProjectAction } from "@/actions/projects";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAction } from "@/lib/action-hooks";
import type { AppProject } from "@/lib/auth";
import { useRouter } from "@/lib/navigation";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { useProjectStore } from "@/stores/projects";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { UpdateProjectLogo } from "./update-project-logo";
import { UpdateProjectName } from "./update-project-name";
import { UpdateProjectSlug } from "./update-project-slug";

interface ProjectSettingsProps {
  project: AppProject;
}

export function ProjectSettings({ project }: ProjectSettingsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { canUpdateProject } = useInstancePolicy();

  const deleteProject = useAction(deleteProjectAction, {
    onSuccess: () => {
      useProjectStore.getState().invalidate(project.slug);
      useProjectStore.getState().setCurrentSlug(null);
      toast.success(t("project:settings.dangerZone.deleteSuccess"));
      router.push("/");
    },
    onError: (error) => {
      toast.error(
        error.error.serverError ?? t("project:settings.dangerZone.deleteError"),
      );
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col">
        <h2 className="text-2xl font-bold">{t("project:settings.heading")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("project:settings.subheading")}
        </p>
      </div>
      {canUpdateProject ? (
        <>
          <UpdateProjectLogo project={project} />

          <UpdateProjectName project={project} />

          <UpdateProjectSlug project={project} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("common:policy.projectUpdateDisabled")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("project:settings.dangerZone.title")}</CardTitle>
          <CardDescription>
            {t("project:settings.dangerZone.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">
            {t("project:settings.dangerZone.deleteWarning")}
          </p>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm" />}
            >
              {t("project:settings.dangerZone.deleteButton")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("project:settings.dangerZone.deleteDialog.title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("project:settings.dangerZone.deleteDialog.description", {
                    name: project.name,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Separator />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteProject.isExecuting}>
                  {t("common:actions.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    deleteProject.execute({ id: project.id });
                  }}
                  disabled={deleteProject.isExecuting}
                >
                  {t("project:settings.dangerZone.deleteButton")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
