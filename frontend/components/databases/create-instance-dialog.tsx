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
  Field,
  FieldGroup,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
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
import { Controller } from "react-hook-form";
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
          toast.error(
            error.error.serverError ?? t("common:state.genericError"),
          );
        },
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={atLimit} />}>
        <Plus className="size-4" />
        {t("project:databases.createDialog.trigger")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project:databases.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("project:databases.createDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmitWithAction}>
          <FieldGroup className="gap-4">
            <Controller
              control={form.control}
              name="type"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {t("project:databases.engineLabel")}
                  </FieldLabel>
                  <Select
                    items={[
                      ...Object.entries(DATABASE_TYPE_LABELS).map(
                        ([value, label]) => ({ value: value, label: label }),
                      ),
                    ]}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <SelectTrigger
                      id={field.name}
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
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
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="display"
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
                      "project:databases.createDialog.namePlaceholder",
                    )}
                  />
                  <FieldDescription>
                    {t("project:databases.createDialog.nameDescription")}
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
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
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
