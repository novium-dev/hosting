"use client";

import { useState } from "react";
import { Boxes, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeServerTemplate, listTemplates } from "@/lib/api";

type ServerTemplateCardProps = {
  serverId: string;
  currentTemplate: string;
  canManage: boolean;
  onChanged: () => void;
};

export function ServerTemplateCard({
  serverId,
  currentTemplate,
  canManage,
  onChanged,
}: ServerTemplateCardProps) {
  const [template, setTemplate] = useState(currentTemplate);
  const [backup, setBackup] = useState(true);
  const [wipe, setWipe] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const { data: templates } = useSWR("templates", async () => {
    const response = await listTemplates();
    return response.error ? [] : [...(response.data ?? [])].sort();
  });

  const onSwitch = async () => {
    setIsSwitching(true);
    try {
      const response = await changeServerTemplate({
        path: { server_id: serverId },
        body: { template, backup, wipe },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to change template");
        return;
      }

      toast.success(`Template changed to ${template}`);
      setConfirming(false);
      onChanged();
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-5 text-muted-foreground" />
            Template
          </CardTitle>
          <CardDescription>
            Switches the server to another template. The new template starts from
            its own defaults — nothing of the current configuration carries over,
            and the startup variables are reset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Current template:</span>
            <Badge variant="secondary" className="font-mono">
              {currentTemplate}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template">New template</Label>
            <Select
              value={template}
              onValueChange={setTemplate}
              disabled={!canManage}
            >
              <SelectTrigger id="template" className="w-full sm:w-72">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {(templates ?? [currentTemplate]).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox
                checked={backup}
                disabled={!canManage}
                onCheckedChange={(next) => setBackup(next === true)}
              />
              <span>
                Back up the server first
                <span className="block text-xs text-muted-foreground">
                  Needs backup permission and a free backup slot. The switch is
                  abandoned if the backup fails.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox
                checked={wipe}
                disabled={!canManage}
                onCheckedChange={(next) => setWipe(next === true)}
              />
              <span>
                Wipe all files
                <span className="block text-xs text-muted-foreground">
                  Deletes everything on the server, so the new template starts
                  clean. Leftover world data usually breaks the new template.
                </span>
              </span>
            </label>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="space-y-1">
              <p>
                Backing up and wiping need the server to be stopped — stop it
                first, or the switch is refused.
              </p>
              <p>
                Port allocations are kept as they are. The new template usually
                expects different ports, so review them under Ports afterwards.
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canManage || isSwitching || !template}
          >
            Change template
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !isSwitching) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {template}
              {template === currentTemplate ? " (same template)" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  The server&apos;s startup configuration is replaced by{" "}
                  {template}&apos;s defaults and pushed to its node. It takes
                  effect the next time the server starts.
                </p>
                <ul className="list-inside list-disc">
                  <li>
                    {backup ? "A backup is taken first" : "No backup is taken"}
                  </li>
                  <li>
                    {wipe
                      ? "Every file on the server is deleted"
                      : "Files are kept as they are"}
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSwitching}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onSwitch();
              }}
              disabled={isSwitching}
            >
              {isSwitching ? "Switching..." : "Change template"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
