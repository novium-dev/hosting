"use client";

import { deleteUserAction } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { appConfig } from "@/constants/config";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "nextjs-toploader/app";
import { toast } from "sonner";

export default function DeleteAccountCard() {
  const router = useRouter();

  const deleteUser = useAction(deleteUserAction, {
    onSuccess: () => {
      toast.success("Account deleted successfully");
      router.push(appConfig.authRoutes.signin);
    },
    onError: (error) => {
      toast.error(error.error.serverError);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
        <CardDescription>
          This action will permanently delete your account and all associated
          data.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardFooter className="flex flex-row justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          This action is irreversible.
        </p>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          loading={deleteUser.isExecuting}
          onClick={() => deleteUser.execute({})}
        >
          Delete Account
        </Button>
      </CardFooter>
    </Card>
  );
}
