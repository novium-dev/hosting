"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DATABASE_TYPE_LABELS } from "@/components/databases/database-type";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createDatabaseInstance, type DatabaseType } from "@/lib/api";
import { INSTANCE_PRESETS, formatEnv, parseEnv } from "./instance-presets";

const ENGINES = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

export function CreateInstanceDialog({
  hostId,
  open,
  onOpenChange,
  onCreated,
}: {
  hostId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [engine, setEngine] = useState<DatabaseType>("postgres");
  const [display, setDisplay] = useState("");
  const [image, setImage] = useState(INSTANCE_PRESETS.postgres.image);
  const [socketPath, setSocketPath] = useState(
    INSTANCE_PRESETS.postgres.socket_path,
  );
  const [imageUid, setImageUid] = useState("70");
  const [imageGid, setImageGid] = useState("70");
  const [env, setEnv] = useState(formatEnv(INSTANCE_PRESETS.postgres.env));
  const [memory, setMemory] = useState("1024");
  const [swap, setSwap] = useState("0");
  const [disk, setDisk] = useState("10240");
  const [cpu, setCpu] = useState("100");
  const [isPending, setIsPending] = useState(false);

  // Switching engines replaces the container-shaped fields with that engine's
  // preset; the resource limits stay as typed.
  useEffect(() => {
    const preset = INSTANCE_PRESETS[engine];
    setImage(preset.image);
    setSocketPath(preset.socket_path);
    setImageUid(String(preset.image_uid));
    setImageGid(String(preset.image_gid));
    setEnv(formatEnv(preset.env));
  }, [engine]);

  useEffect(() => {
    if (open) setDisplay("");
  }, [open]);

  const submit = async () => {
    const preset = INSTANCE_PRESETS[engine];

    setIsPending(true);
    try {
      const response = await createDatabaseInstance({
        path: { host_id: hostId },
        body: {
          display,
          database_type: engine,
          image,
          image_uid: Number(imageUid),
          image_gid: Number(imageGid),
          socket_path: socketPath,
          volumes: preset.volumes,
          cmd: preset.cmd,
          env: parseEnv(env),
          memory: Number(memory),
          swap: Number(swap),
          disk: Number(disk),
          cpu: Number(cpu),
        },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? "Failed to create the instance",
        );
        return;
      }

      toast.success("Instance created");
      onOpenChange(false);
      onCreated();
    } finally {
      setIsPending(false);
    }
  };

  const numbersValid = [memory, swap, disk, cpu, imageUid, imageGid].every(
    (value) => value.trim() !== "" && Number.isFinite(Number(value)),
  );
  const canSubmit =
    display.trim() !== "" &&
    image.trim() !== "" &&
    socketPath.trim() !== "" &&
    numbersValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create instance</DialogTitle>
          <DialogDescription>
            The container runs with no network; the agent reaches it over the
            unix socket below. Fields are prefilled per engine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="engine">Engine</Label>
              <Select
                value={engine}
                onValueChange={(value) => setEngine(value as DatabaseType)}
              >
                <SelectTrigger id="engine" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENGINES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {DATABASE_TYPE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="instance-display">Name</Label>
              <Input
                id="instance-display"
                value={display}
                onChange={(event) => setDisplay(event.target.value)}
                placeholder="postgres-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="image">Image</Label>
            <Input
              id="image"
              value={image}
              onChange={(event) => setImage(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="socket-path">Socket path (in the container)</Label>
            <Input
              id="socket-path"
              value={socketPath}
              onChange={(event) => setSocketPath(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="image-uid">Image UID</Label>
              <Input
                id="image-uid"
                inputMode="numeric"
                value={imageUid}
                onChange={(event) => setImageUid(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="image-gid">Image GID</Label>
              <Input
                id="image-gid"
                inputMode="numeric"
                value={imageGid}
                onChange={(event) => setImageGid(event.target.value)}
              />
            </div>
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

          <div className="space-y-2">
            <Label htmlFor="env">Environment</Label>
            <Textarea
              id="env"
              value={env}
              onChange={(event) => setEnv(event.target.value)}
              rows={4}
              className="font-mono text-xs"
              placeholder="KEY=value"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || isPending}
            loading={isPending}
          >
            Create instance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
