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
import { toast } from "sonner";

export function UpdateOrganizationName({
  organization,
}: {
  organization: AppOrganization;
}) {
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
            toast.success("Organization name updated successfully");
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
            <CardTitle>Organization Name</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Please enter your organization name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="My Organization" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <Separator />
          <CardFooter className="flex flex-row justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              This action will update the name of the organization.
            </p>
            <Button type="submit" size="sm" loading={action.isExecuting}>
              Save
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
