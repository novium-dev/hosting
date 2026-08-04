"use client";

import { createDatabaseAction } from "@/actions/databases";
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
import { createDatabaseSchema } from "@/types/database.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DATABASE_TYPE_LABELS } from "./database-type";

interface CreateDatabaseDialogProps {
  projectId: string;
  /** Whether the project is already at its database limit. */
  atLimit: boolean;
  onCreated: () => void;
}

export function CreateDatabaseDialog({
  projectId,
  atLimit,
  onCreated,
}: CreateDatabaseDialogProps) {
  const [open, setOpen] = useState(false);

  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(createDatabaseAction, zodResolver(createDatabaseSchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          projectId,
          name: "",
          type: "postgres" as const,
        },
      },
      actionProps: {
        onSuccess: () => {
          resetFormAndAction();
          setOpen(false);
          onCreated();
          toast.success("Database created");
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
          New database
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create database</DialogTitle>
          <DialogDescription>
            The database is created on a host in your project&apos;s region, with
            its own user. Credentials are shown once it exists.
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="analytics" />
                  </FormControl>
                  <FormDescription>
                    Lowercase letters and digits only. The database and its user
                    get a unique suffix on the host.
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
                Create database
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
