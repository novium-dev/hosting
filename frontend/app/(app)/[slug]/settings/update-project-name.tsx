import { updateProjectNameAction } from "@/actions/projects";
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
import { updateProjectNameSchema } from "@/types/project.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@/lib/action-hooks";
import type { AppProject } from "@/lib/auth";
import { useProjectStore } from "@/stores/projects";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function UpdateProjectName({ project }: { project: AppProject }) {
  const { t } = useTranslation();
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      updateProjectNameAction,
      zodResolver(updateProjectNameSchema),
      {
        formProps: {
          mode: "onChange",
          defaultValues: { id: project.id, name: project.name },
        },
        actionProps: {
          onSuccess: () => {
            resetFormAndAction();
            // Drop the cached project so the new name is refetched on next view.
            useProjectStore.getState().invalidate(project.slug);
            toast.success(t("project:settings.nameCard.success"));
          },
          onError: (error) => {
            toast.error(error.error.serverError);
          },
        },
      },
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
