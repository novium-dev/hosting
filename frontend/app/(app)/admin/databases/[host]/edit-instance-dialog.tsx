"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateDatabaseInstance } from "@/lib/api";
import type { DatabaseInstanceRow } from "./database-instances-table";

export function EditInstanceDialog({
  hostId,
  instance,
  open,
  onOpenChange,
  onSaved,
}: {
  hostId: string;
  instance?: DatabaseInstanceRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [display, setDisplay] = useState("");
  const [memory, setMemory] = useState("");
  const [swap, setSwap] = useState("");
  const [disk, setDisk] = useState("");
  const [cpu, setCpu] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!open || !instance) return;

    setDisplay(instance.display);
    setMemory(String(instance.remote?.memory ?? ""));
    setSwap(String(instance.remote?.swap ?? ""));
    setDisk(String(instance.remote?.disk ?? ""));
    setCpu(String(instance.remote?.cpu ?? ""));
    setSuspended(instance.remote?.suspended ?? false);
  }, [open, instance]);

  const submit = async () => {
    if (!instance) return;

    setIsPending(true);
    try {
      const response = await updateDatabaseInstance({
        path: { host_id: hostId, instance_id: instance.id },
        body: {
          display,
          memory: Number(memory),
          swap: Number(swap),
          disk: Number(disk),
          cpu: Number(cpu),
          suspended,
        },
      });

      if (response.error) {
        toast.error(response.error.error?.msg ?? "Failed to save the instance");
        return;
      }

      toast.success("Instance updated");
      onOpenChange(false);
      onSaved();
    } finally {
      setIsPending(false);
    }
  };

  const numbersValid = [memory, swap, disk, cpu].every(
    (value) => value.trim() !== "" && Number.isFinite(Number(value)),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {instance?.display}</DialogTitle>
          <DialogDescription>
            Owned by {instance?.project_slug}. New limits apply to the running
            container; memory and cpu take effect immediately, disk on the next
            check.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="instance-display">Name</Label>
            <Input
              id="instance-display"
              value={display}
              onChange={(event) => setDisplay(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="memory">Memory (MiB)</Label>
              <Input
                id="memory"
                inputMode="numeric"
                value={memory}
                onChange={(event) => setMemory(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="swap">Swap (MiB)</Label>
              <Input
                id="swap"
                inputMode="numeric"
                value={swap}
                onChange={(event) => setSwap(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disk">Disk (MiB)</Label>
              <Input
                id="disk"
                inputMode="numeric"
                value={disk}
                onChange={(event) => setDisk(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpu">CPU (%)</Label>
              <Input
                id="cpu"
                inputMode="numeric"
                value={cpu}
                onChange={(event) => setCpu(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="suspended">Suspended</Label>
              <p className="text-xs text-muted-foreground">
                Rejects every client connection at the proxy.
              </p>
            </div>
            <Switch
              id="suspended"
              checked={suspended}
              onCheckedChange={setSuspended}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={display.trim() === "" || !numbersValid || isPending}
            loading={isPending}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
