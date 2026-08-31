import { updateProjectSlugAction } from "@/actions/projects";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { updateProjectSlugSchema } from "@/types/project.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { AppProject } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function UpdateProjectSlug({ project }: { project: AppProject }) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState({
    initialValue: project.slug,
    value: "",
    isValidating: false,
    isError: false,
  });
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      updateProjectSlugAction,
      zodResolver(updateProjectSlugSchema),
      {
        formProps: {
          mode: "onChange",
          defaultValues: { id: project.id, slug: project.slug },
        },
        actionProps: {
          onSuccess: () => {
            resetFormAndAction();
            toast.success(t("project:settings.slugCard.success"));
          },
          onError: (error) => {
            toast.error(error.error.serverError);
          },
        },
      },
    );

  const handleSlugCheck = useCallback(
    async (value: string) => {
      try {
        setSlug((prev) => ({ ...prev, isValidating: true }));
        if (value === slug.initialValue) return;
        const { error } = await authClient.project.checkSlug({
          slug: value,
        });
        if (error) {
          setSlug((prev) => ({ ...prev, isError: true }));
          form.setError("slug", {
            message: t("project:settings.slugCard.slugTaken"),
          });
        } else {
          setSlug((prev) => ({ ...prev, isError: false }));
        }
      } catch (error) {
        setSlug((prev) => ({ ...prev, isError: true }));
        form.setError("slug", {
          message: t("project:settings.slugCard.checkError"),
        });
      } finally {
        setSlug((prev) => ({ ...prev, isValidating: false }));
      }
    },
    [form, slug.initialValue, t],
  );

  useEffect(() => {
    if (!slug.value) return;

    const timer = setTimeout(() => {
      handleSlugCheck(slug.value);
    }, 800);

    return () => clearTimeout(timer);
  }, [slug.value, handleSlugCheck]);

  const disabledForm =
    action.isExecuting ||
    !form.formState.isValid ||
    slug.isValidating ||
    slug.value === slug.initialValue;

  return (
    <Form {...form}>
      <form onSubmit={handleSubmitWithAction} className="space-y-4">
        <input type="hidden" {...form.register("id")} />
        <Card>
          <CardHeader>
            <CardTitle>{t("project:settings.slugCard.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("project:settings.slugCard.label")}</FormLabel>
                  <FormControl>
                    <InputGroup>
                      <InputGroupInput
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setSlug((prev) => ({
                            ...prev,
                            value: e.target.value,
                          }));
                        }}
                        placeholder={t("project:settings.slugCard.placeholder")}
                        className="pl-1!"
                      />
                      <InputGroupAddon>
                        <InputGroupText>/</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupAddon align="inline-end">
                        {slug.isValidating ? (
                          <Spinner />
                        ) : slug.isError ? (
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
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <Separator />
          <CardFooter className="flex flex-row justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {t("project:settings.slugCard.hint")}
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={disabledForm}
              loading={action.isExecuting}
            >
              {t("common:actions.save")}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
