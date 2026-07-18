"use client";

import {
  createOrganizationAction,
  setActiveOrganizationAction,
} from "@/actions/organizations";
import { Button } from "@/components/ui/button";
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { OrganizationAvatar } from "@/components/ui/organization-avatar";
import { Spinner } from "@/components/ui/spinner";
import { isReservedSlug } from "@/constants/reserved-slugs";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import { authClient } from "@/lib/auth-client";
import type { AppOrganization } from "@/lib/auth";
import { createOrganizationSchema } from "@/types/organization.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type CreateOrganizationFormProps = {
  onSuccess: (organization: AppOrganization) => void;
};

export function CreateOrganizationForm({
  onSuccess,
}: CreateOrganizationFormProps) {
  const [isValidatingSlug, setIsValidatingSlug] = useState(false);
  const [isSlugError, setIsSlugError] = useState(false);
  const [slugToCheck, setSlugToCheck] = useState("");

  const setActiveOrganization = useAction(setActiveOrganizationAction);

  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      createOrganizationAction,
      zodResolver(createOrganizationSchema),
      {
        formProps: {
          mode: "onChange",
          defaultValues: { name: "", slug: "" },
        },
        actionProps: {
          onSuccess: async (args) => {
            resetFormAndAction();
            if (args.data?.data) {
              const organization = args.data.data;
              await setActiveOrganization.executeAsync({
                slug: organization.slug,
                id: organization.id,
              });
              onSuccess?.(organization);
            }
            toast.success("Organization created successfully");
          },
          onError: (error) => {
            toast.error(error.error.serverError);
          },
        },
      },
    );

  const handleSlugCheck = useCallback(
    async (slug: string) => {
      if (isReservedSlug(slug)) {
        setIsSlugError(true);
        form.setError("slug", {
          message: "This slug is reserved and cannot be used",
        });
        return;
      }

      try {
        setIsValidatingSlug(true);
        const { error } = await authClient.organization.checkSlug({ slug });
        if (error) {
          setIsSlugError(true);
          form.setError("slug", { message: "Slug is already taken" });
        } else {
          setIsSlugError(false);
        }
      } catch (error) {
        setIsSlugError(true);
        form.setError("slug", { message: "Error checking slug" });
      } finally {
        setIsValidatingSlug(false);
      }
    },
    [form],
  );

  useEffect(() => {
    if (!slugToCheck) return;

    const timer = setTimeout(() => {
      handleSlugCheck(slugToCheck);
    }, 800);

    return () => clearTimeout(timer);
  }, [slugToCheck, handleSlugCheck]);

  const watchName = form.watch("name");

  useEffect(() => {
    if (watchName.trim() === "") {
      form.setValue("slug", "");
      return;
    }
    const slug = watchName.toLowerCase().replace(/ /g, "-");
    setSlugToCheck(slug);
    form.setValue("slug", slug);
  }, [watchName, form]);

  return (
    <Form {...form}>
      <form onSubmit={handleSubmitWithAction}>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <OrganizationAvatar
              orgId="preview"
              orgName={form.watch("name")}
              className="w-10 h-10"
            />
            <div className="flex flex-col">
              <TextEllipsis width={140}>{form.watch("name")}</TextEllipsis>
              <TextEllipsis width={140} className="text-xs">
                {form.watch("slug")}
              </TextEllipsis>
            </div>
          </div>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} type="text" placeholder="Acme Inc." />
                </FormControl>
                <FormMessage />
                <FormDescription>
                  This is the name of your organization.
                </FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <InputGroup>
                    <InputGroupInput
                      {...field}
                      placeholder="acme-inc"
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
                      ) : isSlugError ? (
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
          <Button
            type="submit"
            className="w-full"
            disabled={
              action.isExecuting || !form.formState.isValid || isValidatingSlug
            }
            loading={action.isExecuting}
          >
            Create Organization
          </Button>
        </div>
      </form>
    </Form>
  );
}
