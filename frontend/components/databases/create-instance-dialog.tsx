"use client";

import { createInstanceAction } from "@/actions/databases";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHookFormAction } from "@/lib/action-hooks";
import { createInstanceSchema } from "@/types/database.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { DATABASE_TYPE_LABELS } from "./database-type";

interface CreateInstanceDialogProps {
  projectId: string;
  /** Whether the project is already at its instance limit. */
  atLimit: boolean;
  onCreated: () => void;
}

export function CreateInstanceDialog({
  projectId,
  atLimit,
  onCreated,
}: CreateInstanceDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(createInstanceAction, zodResolver(createInstanceSchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          projectId,
          display: "",
          type: "postgres" as const,
        },
      },
      actionProps: {
        onSuccess: () => {
          resetFormAndAction();
          setOpen(false);
          onCreated();
          toast.success(t("project:databases.createDialog.created"));
        },
        onError: (error) => {
          toast.error(error.error.serverError ?? t("common:state.genericError"));
        },
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={atLimit}>
          <Plus className="size-4" />
          {t("project:databases.createDialog.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project:databases.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:databases.createDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmitWithAction} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("project:databases.engineLabel")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(DATABASE_TYPE_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="display"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common:labels.name")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t("project:databases.createDialog.namePlaceholder")}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("project:databases.createDialog.nameDescription")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="submit"
                className="w-full"
                loading={action.isExecuting}
              >
                {t("project:databases.createDialog.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
