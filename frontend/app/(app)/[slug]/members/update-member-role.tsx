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
  Field,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { PermissionsField } from "@/components/permissions-field";
import { MembershipExpiryField } from "./membership-expiry-field";
import { ServerPermission } from "@/lib/permissions";
import { setProjectUserSchema } from "@/types/project-user.schema";
import { Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { useEffect } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { useTranslation } from "react-i18next";
import type { ProjectMember } from "@/types/api";

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
          void mutate(["project-users", projectId]);
          resetFormAndAction();
          setOpen(false);
          toast.success(t("project:members.updateDialog.success"));
        },
        onError: (error) => {
          toast.error(
            error.error.serverError ?? t("common:state.genericError"),
          );
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
        <form onSubmit={handleSubmitWithAction}>
          <FieldGroup className="gap-4">
            <input type="hidden" {...form.register("projectId")} />
            <input type="hidden" {...form.register("email")} />
            <Controller
              control={form.control}
              name="permissions"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldTitle>{t("common:labels.permissions")}</FieldTitle>
                  <PermissionsField
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="expiresAt"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldTitle>{t("project:members.expiry.label")}</FieldTitle>
                  <MembershipExpiryField
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              loading={action.isExecuting}
            >
              {t("project:members.updateDialog.submit")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
