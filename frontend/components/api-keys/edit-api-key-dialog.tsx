"use client";

import { updateApiKeyAction } from "@/actions/api-keys";
import { ApiKeyPermissionsField } from "@/components/api-keys/api-key-permissions-field";
import type { ApiKey } from "@/components/api-keys/api-keys-table";
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
import { Input } from "@/components/ui/input";
import { useHookFormAction } from "@/lib/action-hooks";
import { updateApiKeySchema } from "@/types/api-key.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface EditApiKeyDialogProps {
  apiKey: ApiKey | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  onUpdated: () => void;
}

export function EditApiKeyDialog({
  apiKey,
  open,
  setOpen,
  onUpdated,
}: EditApiKeyDialogProps) {
  const { t } = useTranslation();
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(updateApiKeyAction, zodResolver(updateApiKeySchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          id: apiKey?.id ?? 0,
          name: apiKey?.name ?? "",
          permissions: apiKey?.permissions ?? 0,
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
          toast.error(error.error.serverError ?? t("common:state.genericError"));
        },
      },
    });

  useEffect(() => {
    if (apiKey) {
      form.reset({
        id: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
      });
    }
  }, [apiKey, form]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("project:apiKeys.editDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:apiKeys.editDialog.description")}
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
                    <Input {...field} />
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
                  {apiKey?.project ? (
                    <FormLabel>{t("common:labels.permissions")}</FormLabel>
                  ) : null}
                  <FormControl>
                    <ApiKeyPermissionsField
                      scoped={Boolean(apiKey?.project)}
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
              {t("common:resources.saveChanges")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
