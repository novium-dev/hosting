"use client";

import { setProjectUserAction } from "@/actions/project-users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { projectRoleFromPermissions } from "@/lib/permissions";
import { setProjectUserSchema } from "@/types/project-user.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { useEffect } from "react";
import { toast } from "sonner";
import type { ProjectMember } from "./members-view";

type UpdateMemberRoleDialogProps = {
  member: ProjectMember | null;
  projectId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function UpdateMemberRoleDialog({
  member,
  projectId,
  open,
  setOpen,
}: UpdateMemberRoleDialogProps) {
  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(setProjectUserAction, zodResolver(setProjectUserSchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          projectId,
          email: member?.email ?? "",
          role: member ? projectRoleFromPermissions(member.permissions) : "member",
        },
      },
      actionProps: {
        onSuccess: () => {
          resetFormAndAction();
          setOpen(false);
          toast.success("Member role updated successfully");
        },
        onError: (error) => {
          toast.error(error.error.serverError ?? "Something went wrong");
        },
      },
    });

  useEffect(() => {
    if (member) {
      form.reset({
        projectId,
        email: member.email,
        role: projectRoleFromPermissions(member.permissions),
      });
    }
  }, [member, form, projectId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Member Role</DialogTitle>
          <DialogDescription>
            Update the member&apos;s role in this project
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmitWithAction} className="space-y-4">
            <input type="hidden" {...form.register("projectId")} />
            <input type="hidden" {...form.register("email")} />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              loading={action.isExecuting}
            >
              Update Role
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
