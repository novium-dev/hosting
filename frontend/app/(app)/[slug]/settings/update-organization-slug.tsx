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
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { AppOrganization } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function UpdateOrganizationSlug({
  organization,
}: {
  organization: AppOrganization;
}) {
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
            toast.success("Organization slug updated successfully");
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
          form.setError("slug", { message: "Slug is already taken" });
        } else {
          setSlug((prev) => ({ ...prev, isError: false }));
        }
      } catch (error) {
        setSlug((prev) => ({ ...prev, isError: true }));
        form.setError("slug", { message: "Error checking slug" });
      } finally {
        setSlug((prev) => ({ ...prev, isValidating: false }));
      }
    },
    [form, slug.initialValue],
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
            <CardTitle>Organization Slug</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Please enter a unique slug</FormLabel>
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
                        placeholder="acme-inc"
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
              Use only lowercase letters, numbers, and hyphens.
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={disabledForm}
              loading={action.isExecuting}
            >
              Save
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
