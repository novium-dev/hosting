"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { deleteInstanceAction } from "@/actions/databases";
import { useAction } from "@/lib/action-hooks";
import { useRouter } from "@/lib/navigation";
import type { ProjectInstance } from "@/types/api";

export function InstanceDeleteCard({
  projectId,
  slug,
  instance,
}: {
  projectId: string;
  slug: string;
  instance: ProjectInstance;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const remove = useAction(deleteInstanceAction, {
    onSuccess: () => {
      toast.success(t("project:databases.deleteCard.deleted"));
      setOpen(false);
      router.push(`/${slug}/databases`);
    },
    onError: (result) => {
      toast.error(
        result.error.serverError ??
          t("project:databases.deleteCard.deleteError"),
      );
    },
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{t("project:databases.deleteCard.title")}</CardTitle>
        <CardDescription>
          {t("project:databases.deleteCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
          disabled={remove.isPending}
        >
          <Trash2 className="size-4" />
          {t("project:databases.deleteCard.deleteButton")}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:confirmDelete.title", { name: instance.display })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:databases.deleteCard.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                void remove.executeAsync({
                  projectId,
                  instanceId: instance.id,
                });
              }}
              disabled={remove.isPending}
            >
              {t("project:databases.deleteCard.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
