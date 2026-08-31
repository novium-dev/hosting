"use client";

import { setProjectUserAction } from "@/actions/project-users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PermissionsField } from "@/components/permissions-field";
import { MembershipExpiryField } from "./membership-expiry-field";
import { ServerPermission } from "@/lib/permissions";
import { setProjectUserSchema } from "@/types/project-user.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ProjectMember } from "./members-view";

type UpdateMemberRoleDialogProps = {
  member: ProjectMember | null;
  projectId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function UpdateMemberRoleDialog({
  member,
  projectId,
  open,
  setOpen,
}: UpdateMemberRoleDialogProps) {
  const { t } = useTranslation();
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(setProjectUserAction, zodResolver(setProjectUserSchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          projectId,
          email: member?.email ?? "",
          permissions: member?.permissions ?? ServerPermission.VIEW,
          expiresAt: member?.expires_at ?? null,
        },
      },
      actionProps: {
        onSuccess: () => {
          resetFormAndAction();
          setOpen(false);
          toast.success(t("project:members.updateDialog.success"));
        },
        onError: (error) => {
          toast.error(error.error.serverError ?? t("common:state.genericError"));
        },
      },
    });

  useEffect(() => {
    if (member) {
      form.reset({
        projectId,
        email: member.email,
        permissions: member.permissions,
        expiresAt: member.expires_at ?? null,
      });
    }
  }, [member, form, projectId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project:members.updateDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:members.updateDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmitWithAction} className="space-y-4">
            <input type="hidden" {...form.register("projectId")} />
            <input type="hidden" {...form.register("email")} />
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
                  <FormLabel>{t("project:members.expiry.label")}</FormLabel>
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
              {t("project:members.updateDialog.submit")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
