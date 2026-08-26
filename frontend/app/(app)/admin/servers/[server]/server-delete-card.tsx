"use client";

import { useRouter } from "@/lib/navigation";
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
import { deleteServer } from "@/lib/api";

type ServerDeleteCardProps = {
  canDelete: boolean;
  serverId: string;
  serverName: string;
};

export function ServerDeleteCard({
  canDelete,
  serverId,
  serverName,
}: ServerDeleteCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const onDelete = async () => {
    setIsDeleting(true);

    try {
      const response = await deleteServer({
        path: { server_id: serverId },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:servers.deleteCard.deleteError"),
        );
        return;
      }

      toast.success(t("admin-infra:servers.deleteCard.deleteSuccess"));
      setOpen(false);
      router.push("/admin/servers");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{t("admin-infra:servers.deleteCard.title")}</CardTitle>
        <CardDescription>
          {t("admin-infra:servers.deleteCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setOpen(true)}
          disabled={!canDelete || isDeleting}
        >
          <Trash2 className="size-4" />
          {t("admin-infra:servers.deleteCard.deleteButton")}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:confirmDelete.title", { name: serverName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:servers.deleteCard.confirmDescription", {
                name: serverName,
              })}{" "}
              {t("common:confirmDelete.cannotBeUndone")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
              disabled={!canDelete || isDeleting}
            >
              {t("admin-infra:servers.deleteCard.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
