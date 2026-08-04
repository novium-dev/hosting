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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHookFormAction } from "@/lib/action-hooks";
import { createInstanceSchema } from "@/types/database.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
          toast.success("Instance created, starting it now");
        },
        onError: (error) => {
          toast.error(error.error.serverError ?? "Something went wrong");
        },
      },
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={atLimit}>
          <Plus className="size-4" />
          New instance
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create database instance</DialogTitle>
          <DialogDescription>
            Your own engine, on a host in your project&apos;s region. Its size is
            set by the platform; you can put as many databases and users on it as
            you like.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmitWithAction} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Engine</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
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
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="display"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Production" />
                  </FormControl>
                  <FormDescription>
                    Only for you to tell instances apart. Renaming it later is up
                    to an administrator.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="submit"
                className="w-full"
                loading={action.isExecuting}
              >
                Create instance
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
