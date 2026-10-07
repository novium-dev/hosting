import { apiErrorMessage } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import { Separator } from "@/components/ui/separator";
import { useInstancePolicy } from "@/hooks/use-instance-policy";
import { deleteProjectLogo, uploadProjectLogo } from "@/lib/api";
import type { AppProject } from "@/lib/auth";
import { useProjectStore } from "@/stores/projects";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function UpdateProjectLogo({ project }: { project: AppProject }) {
  const { t } = useTranslation();
  const { canUploadProjectLogo } = useInstancePolicy();
  const { mutate } = useSWRConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, setIsPending] = useState(false);

  if (!canUploadProjectLogo && !project.logo_url) return null;

  const refresh = () => {
    useProjectStore.getState().invalidate(project.slug);
    void mutate("switcher/own-projects");
  };

  const upload = async (file: File) => {
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      toast.error(t("project:settings.logoCard.invalid"));
      return;
    }

    setIsPending(true);
    const response = await uploadProjectLogo({
      path: { project_id: project.id },
      body: file,
    });
    setIsPending(false);

    if (response.error) {
      toast.error(
        apiErrorMessage(
          response.error,
          t("project:settings.logoCard.uploadError"),
        ),
      );
      return;
    }

    refresh();
    toast.success(t("project:settings.logoCard.uploadSuccess"));
  };

  const remove = async () => {
    setIsPending(true);
    const response = await deleteProjectLogo({
      path: { project_id: project.id },
    });
    setIsPending(false);

    if (response.error) {
      toast.error(
        apiErrorMessage(
          response.error,
          t("project:settings.logoCard.removeError"),
        ),
      );
      return;
    }

    refresh();
    toast.success(t("project:settings.logoCard.removeSuccess"));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("project:settings.logoCard.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <ProjectAvatar
          projectId={project.id}
          projectName={project.name}
          logoUrl={project.logo_url}
          className="size-16 text-xl"
        />
        <input
          ref={inputRef}
          type="file"
          accept={LOGO_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        {canUploadProjectLogo && (
          <Button
            size="sm"
            variant="outline"
            loading={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {t("common:actions.upload")}
          </Button>
        )}
        {project.logo_url && (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => void remove()}
          >
            {t("common:actions.remove")}
          </Button>
        )}
      </CardContent>
      {canUploadProjectLogo && (
        <>
          <Separator />
          <CardFooter>
            <p className="text-sm text-muted-foreground">
              {t("project:settings.logoCard.description")}
            </p>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
