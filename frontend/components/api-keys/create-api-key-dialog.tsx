"use client";

import { createApiKeyAction } from "@/actions/api-keys";
import { ApiKeyPermissionsField } from "@/components/api-keys/api-key-permissions-field";
import { useGrantablePermissions } from "@/hooks/use-grantable-permissions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useHookFormAction } from "@/lib/action-hooks";
import { createApiKeySchema } from "@/types/api-key.schema";
import { Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";

interface CreateApiKeyDialogProps {
  /** Project the key is scoped to; omit for an instance-wide key. */
  projectId?: string;
  /** The viewer's permissions in that project. */
  projectPermissions?: number;
  /** Called after a key was created, to refresh the list. */
  onCreated: () => void;
}

export function CreateApiKeyDialog({
  projectId,
  projectPermissions,
  onCreated,
}: CreateApiKeyDialogProps) {
  const { t } = useTranslation();
  const grantable = useGrantablePermissions(
    projectId === undefined ? undefined : (projectPermissions ?? 0),
  );
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(createApiKeyAction, zodResolver(createApiKeySchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          name: "",
          projectId,
          permissions: 0,
        },
      },
      actionProps: {
        onSuccess: ({ data }) => {
          resetFormAndAction();
          setOpen(false);
          // The only moment the token exists in the clear.
          setToken(data?.key ?? null);
          onCreated();
        },
        onError: (error) => {
          toast.error(
            error.error.serverError ?? t("common:state.genericError"),
          );
        },
      },
    });

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success(t("project:apiKeys.createDialog.copied"));
    } catch {
      toast.error(t("project:apiKeys.createDialog.copyFailed"));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>
          <Plus className="size-4" />
          {t("project:apiKeys.createDialog.trigger")}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("project:apiKeys.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {projectId
                ? t("project:apiKeys.createDialog.descriptionProject")
                : t("project:apiKeys.createDialog.descriptionInstance")}
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
                      placeholder={t(
                        "project:apiKeys.createDialog.namePlaceholder",
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
                    {projectId ? (
                      <FieldTitle>{t("common:labels.permissions")}</FieldTitle>
                    ) : null}
                    <ApiKeyPermissionsField
                      scoped={projectId !== undefined}
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
                {t("project:apiKeys.createDialog.submit")}
              </Button>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={token !== null}
        onOpenChange={(next) => {
          if (!next) setToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-muted-foreground" />
              {t("project:apiKeys.createDialog.copyTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("project:apiKeys.createDialog.copyDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={token ?? ""} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void copyToken()}
              aria-label={t("project:apiKeys.createDialog.copyAriaLabel")}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            <Trans
              i18nKey="project:apiKeys.createDialog.sendAs"
              components={{ code: <code className="font-mono" /> }}
            />
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setToken(null)}>
              {t("project:apiKeys.createDialog.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
