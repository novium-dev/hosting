import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SchedulePolicy, type ScheduleTask } from "@/lib/api";
import { cronFields, parseCron } from "@/lib/cron";
import { CronEditor } from "./cron-editor";
import { TaskList } from "./task-list";
import {
  DEFAULT_CRON,
  POLICIES,
  localTimezone,
  taskFitsBackupLimit,
  taskIsComplete,
  timezones,
  type Schedule,
  type ScheduleBody,
  type TaskType,
} from "./utils";

type EditorOptions = {
  isAvailable: (type: TaskType) => boolean;
  backupLimit: number | null;
  canDeleteBackups: boolean;
};

const DEFAULT_TASKS: ScheduleTask[] = [{ type: "restart" }];

function ScheduleForm({
  schedule,
  busy,
  options,
  onCancel,
  onSave,
}: {
  schedule: Schedule | null;
  busy: boolean;
  options: EditorOptions;
  onCancel: () => void;
  onSave: (body: ScheduleBody) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(schedule?.name ?? "");
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [policy, setPolicy] = useState(
    schedule?.policy ?? SchedulePolicy.ALWAYS,
  );
  const [cron, setCron] = useState(
    schedule ? cronFields(schedule.cron) : DEFAULT_CRON,
  );
  const [timezone, setTimezone] = useState(
    schedule?.timezone ?? localTimezone(),
  );
  const [tasks, setTasks] = useState(
    schedule && schedule.tasks.length > 0 ? schedule.tasks : DEFAULT_TASKS,
  );
  const [zones] = useState(timezones);

  const expression = cron.map((field) => field.trim()).join(" ");
  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedName.length <= 64 &&
    parseCron(expression) !== null &&
    timezone.length > 0 &&
    tasks.length > 0 &&
    tasks.every(
      (task) =>
        taskIsComplete(task) && taskFitsBackupLimit(task, options.backupLimit),
    );
  const policies = POLICIES.map((entry) => ({
    value: entry,
    label: t(`servers:schedules.policies.${entry}`),
  }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {schedule
            ? t("servers:schedules.dialog.editTitle")
            : t("servers:schedules.dialog.createTitle")}
        </DialogTitle>
        <DialogDescription>
          {t("servers:schedules.dialog.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-name">{t("common:labels.name")}</Label>
          <Input
            id="schedule-name"
            value={name}
            maxLength={64}
            placeholder={t("servers:schedules.dialog.namePlaceholder")}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <CronEditor cron={cron} timezone={timezone} onChange={setCron} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-timezone">
              {t("servers:schedules.dialog.timezone")}
            </Label>
            <Select
              value={timezone}
              onValueChange={(value) => setTimezone(value ?? "")}
            >
              <SelectTrigger id="schedule-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="schedule-policy">
              {t("servers:schedules.dialog.policy")}
            </Label>
            <Select
              items={policies}
              value={policy}
              onValueChange={(value) => value && setPolicy(value)}
            >
              <SelectTrigger id="schedule-policy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {policies.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`servers:schedules.policyHelp.${policy}`)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="schedule-enabled">
              {t("common:status.enabled")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("servers:schedules.dialog.enabledHelp")}
            </p>
          </div>
          <Switch
            id="schedule-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <TaskList tasks={tasks} onChange={setTasks} {...options} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="button"
          onClick={() =>
            onSave({
              name: trimmedName,
              enabled,
              policy,
              cron: expression,
              timezone,
              tasks,
            })
          }
          disabled={busy || !canSubmit}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("common:actions.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ScheduleEditorDialog({
  open,
  onOpenChange,
  schedule,
  busy,
  options,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: Schedule | null;
  busy: boolean;
  options: EditorOptions;
  onSave: (body: ScheduleBody) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <ScheduleForm
          schedule={schedule}
          busy={busy}
          options={options}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  );
}
