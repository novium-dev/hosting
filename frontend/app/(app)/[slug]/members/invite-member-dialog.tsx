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
  Field,
  FieldGroup,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PermissionsField } from "@/components/permissions-field";
import { MembershipExpiryField } from "./membership-expiry-field";
import { ServerPermission } from "@/lib/permissions";
import { setProjectUserSchema } from "@/types/project-user.schema";
import { Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { useTranslation } from "react-i18next";

export function InviteMemberDialog({
  projectId,
  grantable,
}: {
  projectId: string;
  grantable: number;
}) {
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
          void mutate(["project-users", projectId]);
          resetFormAndAction();
          setOpen(false);
          toast.success(t("project:members.inviteDialog.success"));
        },
        onError: (error) => {
          toast.error(
            error.error.serverError ?? t("common:state.genericError"),
          );
        },
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="h-4 w-4" />
        {t("project:members.inviteDialog.trigger")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project:members.inviteDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:members.inviteDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmitWithAction}>
          <FieldGroup className="gap-4">
            <input type="hidden" {...form.register("projectId")} />
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {t("common:labels.email")}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                    {...field}
                    type="email"
                    placeholder={t(
                      "project:members.inviteDialog.emailPlaceholder",
                    )}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="permissions"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldTitle>{t("common:labels.permissions")}</FieldTitle>
                  <PermissionsField
                    value={field.value}
                    onChange={field.onChange}
                    grantable={grantable}
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
              {t("project:members.inviteDialog.submit")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
