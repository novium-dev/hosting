"use client";

import { apiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import { FolderInput } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { moveServer } from "@/lib/api";

type ServerMoveCardProps = {
  canMove: boolean;
  serverId: string;
  serverName: string;
  currentProject: string;
  projects: Array<{ id: string; slug: string; name: string }>;
  onMoved: () => void;
};

export function ServerMoveCard({
  canMove,
  serverId,
  serverName,
  currentProject,
  projects,
  onMoved,
}: ServerMoveCardProps) {
  const { t } = useTranslation();
  const [project, setProject] = useState("");
  const [open, setOpen] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const targets = projects.filter((entry) => entry.id !== currentProject);
  const target = targets.find((entry) => entry.id === project);

  const onMove = async () => {
    if (!target) return;
    setIsMoving(true);

    try {
      const response = await moveServer({
        path: { server_id: serverId },
        body: target.id,
      });

      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("admin-infra:servers.moveCard.moveError"),
          ),
        );
        return;
      }

      toast.success(
        t("admin-infra:servers.moveCard.moveSuccess", { project: target.name }),
      );
      setOpen(false);
      setProject("");
      onMoved();
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{t("admin-infra:servers.moveCard.title")}</CardTitle>
        <CardDescription>
          {t("admin-infra:servers.moveCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="move-project">
            {t("admin-infra:servers.moveCard.targetLabel")}
          </Label>
          <Select
            items={[
              ...targets.map((entry) => ({
                value: entry.id,
                label: (
                  <>
                    {entry.name}({entry.slug})
                  </>
                ),
              })),
            ]}
            value={project}
            onValueChange={(value) => setProject(value ?? "")}
            disabled={!canMove || isMoving}
          >
            <SelectTrigger id="move-project" className="w-full sm:w-72">
              <SelectValue
                placeholder={t(
                  "admin-infra:servers.moveCard.targetPlaceholder",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {targets.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name} ({entry.slug})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
          disabled={!canMove || !target || isMoving}
        >
          <FolderInput className="size-4" />
          {t("admin-infra:servers.moveCard.moveButton")}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:servers.moveCard.confirmTitle", {
                name: serverName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:servers.moveCard.confirmDescription", {
                name: serverName,
                project: target?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMoving}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void onMove();
              }}
              disabled={!canMove || !target || isMoving}
            >
              {t("admin-infra:servers.moveCard.moveButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
