"use client";

import { createProjectAction } from "@/actions/projects";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import { SearchableSelect } from "@/components/searchable-select";
import { Spinner } from "@/components/ui/spinner";
import { isReservedSlug } from "@/constants/reserved-slugs";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import { authClient } from "@/lib/auth-client";
import type { AppProject } from "@/lib/auth";
import {
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  createProjectSchema,
} from "@/types/project.schema";
import { slugify } from "@/lib/utils";
import { Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type ProjectOwnerOption = { id: number; username: string };

type CreateProjectFormProps = {
  onSuccess: (project: AppProject) => void;
  // When passed, the project is created for the picked user instead of the
  // current one. Requires the USER_MANAGE permission on the backend.
  owners?: ProjectOwnerOption[];
};

export function CreateProjectForm({
  onSuccess,
  owners,
}: CreateProjectFormProps) {
  const { t } = useTranslation(["app", "common"]);
  const [isValidatingSlug, setIsValidatingSlug] = useState(false);
  const [isSlugError, setIsSlugError] = useState(false);
  const [slugToCheck, setSlugToCheck] = useState("");

  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(createProjectAction, zodResolver(createProjectSchema), {
      formProps: {
        mode: "onChange",
        defaultValues: { name: "", slug: "", owner: undefined },
      },
      actionProps: {
        onSuccess: (args) => {
          resetFormAndAction();
          if (args.data?.data) {
            onSuccess?.(args.data.data);
          }
          toast.success(t("app:createProjectForm.createdSuccess"));
        },
        onError: (error) => {
          toast.error(error.error.serverError);
        },
      },
    });

  const handleSlugCheck = useCallback(
    async (slug: string) => {
      if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX_LENGTH) {
        setIsSlugError(true);
        return;
      }

      if (isReservedSlug(slug)) {
        setIsSlugError(true);
        form.setError("slug", {
          message: t("app:createProjectForm.slugReserved"),
        });
        return;
      }

      try {
        setIsValidatingSlug(true);
        const { error } = await authClient.project.checkSlug({ slug });
        if (error) {
          setIsSlugError(true);
          form.setError("slug", {
            message: t("app:createProjectForm.slugTaken"),
          });
        } else {
          setIsSlugError(false);
        }
      } catch (error) {
        setIsSlugError(true);
        form.setError("slug", {
          message: t("app:createProjectForm.slugCheckError"),
        });
      } finally {
        setIsValidatingSlug(false);
      }
    },
    [form, t],
  );

  useEffect(() => {
    if (!slugToCheck) return;

    const timer = setTimeout(() => {
      handleSlugCheck(slugToCheck);
    }, 800);

    return () => clearTimeout(timer);
  }, [slugToCheck, handleSlugCheck]);

  const hasSlugError = isSlugError || form.formState.errors.slug !== undefined;

  const applyNameToSlug = (name: string) => {
    const slug = name.trim() === "" ? "" : slugify(name, SLUG_MAX_LENGTH);
    setSlugToCheck(slug);
    form.setValue("slug", slug, { shouldValidate: slug !== "" });
  };

  return (
    <form onSubmit={handleSubmitWithAction}>
      <FieldGroup className="gap-4">
        <div className="flex items-center gap-2">
          <ProjectAvatar
            projectId="preview"
            projectName={form.watch("name")}
            className="size-10"
          />
          <div className="flex flex-col">
            <TextEllipsis width={140}>{form.watch("name")}</TextEllipsis>
            <TextEllipsis width={140} className="text-xs">
              {form.watch("slug")}
            </TextEllipsis>
          </div>
        </div>
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
                onChange={(event) => {
                  field.onChange(event);
                  applyNameToSlug(event.target.value);
                }}
                type="text"
                placeholder={t("app:createProjectForm.namePlaceholder")}
              />
              <FieldDescription>
                {t("app:createProjectForm.nameDescription")}
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {owners ? (
          <Controller
            control={form.control}
            name="owner"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldTitle>{t("common:labels.owner")}</FieldTitle>
                <SearchableSelect
                  value={field.value ? String(field.value) : ""}
                  onChange={(value) => field.onChange(Number(value))}
                  options={owners.map((owner) => ({
                    value: String(owner.id),
                    label: owner.username,
                  }))}
                  placeholder={t("app:createProjectForm.ownerPlaceholder")}
                />
                <FieldDescription>
                  {t("app:createProjectForm.ownerDescription")}
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        ) : null}
        <Controller
          control={form.control}
          name="slug"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>
                {t("app:createProjectForm.slugLabel")}
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={field.name}
                  aria-invalid={fieldState.invalid}
                  {...field}
                  placeholder={t("app:createProjectForm.slugPlaceholder")}
                  onChange={(e) => {
                    field.onChange(e);
                    setSlugToCheck(e.target.value);
                  }}
                />
                <InputGroupAddon>
                  <InputGroupText>/</InputGroupText>
                </InputGroupAddon>
                <InputGroupAddon align="inline-end">
                  {isValidatingSlug ? (
                    <Spinner />
                  ) : !field.value ? null : hasSlugError ? (
                    <div className="bg-destructive text-white flex size-4 items-center justify-center rounded-full">
                      <IconX className="size-3" />
                    </div>
                  ) : (
                    <div className="bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-full">
                      <IconCheck className="size-3" />
                    </div>
                  )}
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {t("app:createProjectForm.slugDescription")}
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={
            action.isExecuting ||
            !form.formState.isValid ||
            isValidatingSlug ||
            hasSlugError ||
            (owners !== undefined && !form.watch("owner"))
          }
          loading={action.isExecuting}
        >
          {t("app:createProjectForm.submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
