import { updateOrganizationSlugAction } from "@/actions/organizations";
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
import { updateOrganizationSlugSchema } from "@/types/organization.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { AppOrganization } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function UpdateOrganizationSlug({
  organization,
}: {
  organization: AppOrganization;
}) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState({
    initialValue: organization.slug,
    value: "",
    isValidating: false,
    isError: false,
  });
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      updateOrganizationSlugAction,
      zodResolver(updateOrganizationSlugSchema),
      {
        formProps: {
          mode: "onChange",
          defaultValues: { id: organization.id, slug: organization.slug },
        },
        actionProps: {
          onSuccess: () => {
            resetFormAndAction();
            toast.success(t("org:settings.slugCard.success"));
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
        const { error } = await authClient.organization.checkSlug({
          slug: value,
        });
        if (error) {
          setSlug((prev) => ({ ...prev, isError: true }));
          form.setError("slug", {
            message: t("org:settings.slugCard.slugTaken"),
          });
        } else {
          setSlug((prev) => ({ ...prev, isError: false }));
        }
      } catch (error) {
        setSlug((prev) => ({ ...prev, isError: true }));
        form.setError("slug", {
          message: t("org:settings.slugCard.checkError"),
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
            <CardTitle>{t("org:settings.slugCard.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("org:settings.slugCard.label")}</FormLabel>
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
                        placeholder={t("org:settings.slugCard.placeholder")}
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
              {t("org:settings.slugCard.hint")}
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
