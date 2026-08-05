"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:databases.editInstanceDialog.saveError"),
        );
        return;
      }

      toast.success(t("admin-infra:databases.editInstanceDialog.saveSuccess"));
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
          <DialogTitle>
            {t("admin-infra:databases.editInstanceDialog.title", {
              name: instance?.display,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("admin-infra:databases.editInstanceDialog.description", {
              project: instance?.project_slug,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="instance-display">{t("common:labels.name")}</Label>
            <Input
              id="instance-display"
              value={display}
              onChange={(event) => setDisplay(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="memory">
                {t("admin-infra:databases.editInstanceDialog.memoryLabel")}
              </Label>
              <Input
                id="memory"
                inputMode="numeric"
                value={memory}
                onChange={(event) => setMemory(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="swap">
                {t("admin-infra:databases.editInstanceDialog.swapLabel")}
              </Label>
              <Input
                id="swap"
                inputMode="numeric"
                value={swap}
                onChange={(event) => setSwap(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disk">
                {t("admin-infra:databases.editInstanceDialog.diskLabel")}
              </Label>
              <Input
                id="disk"
                inputMode="numeric"
                value={disk}
                onChange={(event) => setDisk(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpu">
                {t("admin-infra:databases.editInstanceDialog.cpuLabel")}
              </Label>
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
              <Label htmlFor="suspended">{t("common:status.suspended")}</Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  "admin-infra:databases.editInstanceDialog.suspendedDescription",
                )}
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
            {t("common:resources.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
