"use client";

import { updateApiKeyAction } from "@/actions/api-keys";
import { ApiKeyPermissionsField } from "@/components/api-keys/api-key-permissions-field";
import type { ApiKey } from "@/components/api-keys/api-keys-table";
import { useGrantablePermissions } from "@/hooks/use-grantable-permissions";
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
  FieldGroup,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useHookFormAction } from "@/lib/action-hooks";
import { updateApiKeySchema } from "@/types/api-key.schema";
import { Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface EditApiKeyDialogProps {
  apiKey: ApiKey | null;
  /** The viewer's permissions in the key's project, when known. */
  projectPermissions?: number;
  /** Update through the admin route, which can reach other users' keys. */
  admin?: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onUpdated: () => void;
}

export function EditApiKeyDialog({
  apiKey,
  projectPermissions,
  admin = false,
  open,
  setOpen,
  onUpdated,
}: EditApiKeyDialogProps) {
  const { t } = useTranslation();
  const grantable = useGrantablePermissions(
    apiKey?.project ? (projectPermissions ?? 0) : undefined,
  );
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(updateApiKeyAction, zodResolver(updateApiKeySchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          id: apiKey?.id ?? 0,
          name: apiKey?.name ?? "",
          permissions: apiKey?.permissions ?? 0,
          admin,
        },
      },
      actionProps: {
        onSuccess: () => {
          resetFormAndAction();
          setOpen(false);
          onUpdated();
          toast.success(t("project:apiKeys.editDialog.updated"));
        },
        onError: (error) => {
          toast.error(
            error.error.serverError ?? t("common:state.genericError"),
          );
        },
      },
    });

  useEffect(() => {
    if (apiKey) {
      form.reset({
        id: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
        admin,
      });
    }
  }, [apiKey, admin, form]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project:apiKeys.editDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:apiKeys.editDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmitWithAction}>
          <FieldGroup className="gap-4">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {t("common:labels.name")}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                    {...field}
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
                  {apiKey?.project ? (
                    <FieldTitle>{t("common:labels.permissions")}</FieldTitle>
                  ) : null}
                  <ApiKeyPermissionsField
                    scoped={Boolean(apiKey?.project)}
                    value={field.value}
                    onChange={field.onChange}
                    grantable={grantable}
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
              {t("common:resources.saveChanges")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
