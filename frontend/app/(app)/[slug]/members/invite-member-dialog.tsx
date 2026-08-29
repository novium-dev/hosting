"use client";

import { setProjectUserAction } from "@/actions/project-users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PermissionsField } from "@/components/permissions-field";
import { MembershipExpiryField } from "./membership-expiry-field";
import { ServerPermission } from "@/lib/permissions";
import { setProjectUserSchema } from "@/types/project-user.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function InviteMemberDialog({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(setProjectUserAction, zodResolver(setProjectUserSchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          projectId,
          email: "",
          permissions: ServerPermission.VIEW,
          expiresAt: null,
        },
      },
      actionProps: {
        onSuccess: () => {
          resetFormAndAction();
          setOpen(false);
          toast.success(t("org:members.inviteDialog.success"));
        },
        onError: (error) => {
          toast.error(error.error.serverError ?? t("common:state.genericError"));
        },
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          {t("org:members.inviteDialog.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("org:members.inviteDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("org:members.inviteDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmitWithAction} className="space-y-4">
            <input type="hidden" {...form.register("projectId")} />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common:labels.email")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder={t("org:members.inviteDialog.emailPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common:labels.permissions")}</FormLabel>
                  <FormControl>
                    <PermissionsField
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expiresAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("org:members.expiry.label")}</FormLabel>
                  <FormControl>
                    <MembershipExpiryField
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              loading={action.isExecuting}
            >
              {t("org:members.inviteDialog.submit")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
