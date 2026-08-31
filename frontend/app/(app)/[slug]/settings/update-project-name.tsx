import { updateOrganizationNameAction } from "@/actions/organizations";
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
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { updateOrganizationNameSchema } from "@/types/organization.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import type { AppOrganization } from "@/lib/auth";
import { useOrganizationStore } from "@/stores/organizations";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function UpdateOrganizationName({
  organization,
}: {
  organization: AppOrganization;
}) {
  const { t } = useTranslation();
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      updateOrganizationNameAction,
      zodResolver(updateOrganizationNameSchema),
      {
        formProps: {
          mode: "onChange",
          defaultValues: { id: organization.id, name: organization.name },
        },
        actionProps: {
          onSuccess: () => {
            resetFormAndAction();
            // Drop the cached org so the new name is refetched on next view.
            useOrganizationStore.getState().invalidate(organization.slug);
            toast.success(t("project:settings.nameCard.success"));
          },
          onError: (error) => {
            toast.error(error.error.serverError);
          },
        },
      }
    );

  return (
    <Form {...form}>
      <form onSubmit={handleSubmitWithAction} className="space-y-4">
        <input type="hidden" {...form.register("id")} />
        <Card>
          <CardHeader>
            <CardTitle>{t("project:settings.nameCard.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("project:settings.nameCard.label")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t("project:settings.nameCard.placeholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <Separator />
          <CardFooter className="flex flex-row justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {t("project:settings.nameCard.description")}
            </p>
            <Button type="submit" size="sm" loading={action.isExecuting}>
              {t("common:actions.save")}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
