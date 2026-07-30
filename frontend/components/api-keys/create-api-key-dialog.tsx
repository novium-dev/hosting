"use client";

import { createApiKeyAction } from "@/actions/api-keys";
import { ApiKeyPermissionsField } from "@/components/api-keys/api-key-permissions-field";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useHookFormAction } from "@/lib/action-hooks";
import { createApiKeySchema } from "@/types/api-key.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface CreateApiKeyDialogProps {
  /** Project the key is scoped to; omit for an instance-wide key. */
  projectId?: string;
  /** Called after a key was created, to refresh the list. */
  onCreated: () => void;
}

export function CreateApiKeyDialog({
  projectId,
  onCreated,
}: CreateApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const { form, action, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(createApiKeyAction, zodResolver(createApiKeySchema), {
      formProps: {
        mode: "onChange",
        defaultValues: {
          name: "",
          projectId,
          permissions: 0,
        },
      },
      actionProps: {
        onSuccess: ({ data }) => {
          resetFormAndAction();
          setOpen(false);
          // The only moment the token exists in the clear.
          setToken(data?.key ?? null);
          onCreated();
        },
        onError: (error) => {
          toast.error(error.error.serverError ?? "Something went wrong");
        },
      },
    });

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success("API key copied");
    } catch {
      toast.error("Failed to copy API key");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            New key
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              {projectId
                ? "The key can only act inside this project, and never beyond your own permissions."
                : "The key acts across the instance, and never beyond your own permissions."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={handleSubmitWithAction} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Deployment pipeline" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="permissions"
                render={({ field }) => (
                  <FormItem>
                    {projectId ? <FormLabel>Permissions</FormLabel> : null}
                    <FormControl>
                      <ApiKeyPermissionsField
                        scoped={projectId !== undefined}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                loading={action.isExecuting}
              >
                Create key
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={token !== null}
        onOpenChange={(next) => {
          if (!next) setToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-muted-foreground" />
              Copy your API key
            </DialogTitle>
            <DialogDescription>
              This is the only time the key is shown. Store it somewhere safe —
              if you lose it, create a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={token ?? ""} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void copyToken()}
              aria-label="Copy API key"
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Send it as{" "}
            <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setToken(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
