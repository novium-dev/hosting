"use client";

import { createApiKeyAction } from "@/actions/api-keys";
import { ApiKeyPermissionsField } from "@/components/api-keys/api-key-permissions-field";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useHookFormAction } from "@/lib/action-hooks";
import { createApiKeySchema } from "@/types/api-key.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";

interface CreateApiKeyDialogProps {
  /** Project the key is scoped to; omit for an instance-wide key. */
  projectId?: string;
  /** Called after a key was created, to refresh the list. */
  onCreated: () => void;
}

export function CreateApiKeyDialog({
  projectId,
  onCreated,
}: CreateApiKeyDialogProps) {
  const { t } = useTranslation();
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
          toast.error(error.error.serverError ?? t("common:state.genericError"));
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
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            {t("project:apiKeys.createDialog.trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("project:apiKeys.createDialog.title")}</DialogTitle>
            <DialogDescription>
              {projectId
                ? t("project:apiKeys.createDialog.descriptionProject")
                : t("project:apiKeys.createDialog.descriptionInstance")}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={handleSubmitWithAction} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common:labels.name")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("project:apiKeys.createDialog.namePlaceholder")}
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
                    {projectId ? (
                      <FormLabel>{t("common:labels.permissions")}</FormLabel>
                    ) : null}
                    <FormControl>
                      <ApiKeyPermissionsField
                        scoped={projectId !== undefined}
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
                {t("project:apiKeys.createDialog.submit")}
              </Button>
            </form>
          </Form>
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
