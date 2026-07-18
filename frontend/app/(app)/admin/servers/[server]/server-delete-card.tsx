"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

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
        toast.error(response.error.error?.msg ?? "Failed to delete server");
        return;
      }

      toast.success("Server deleted");
      setOpen(false);
      router.push("/admin/servers");
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete Server</CardTitle>
        <CardDescription>
          Permanently delete this server and remove it from the node.
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
          Delete Server
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {serverName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes server {serverId}. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
              disabled={!canDelete || isDeleting}
            >
              Delete Server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
