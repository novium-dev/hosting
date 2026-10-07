import { useState, type DragEvent } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduleTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RetentionTaskField } from "./retention-field";
import { TASK_TYPES, emptyTask, formatSleepHint, type TaskType } from "./utils";

function SleepTaskField({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const hint = formatSleepHint(value, i18n.language);

  return (
    <div className="flex w-full items-center gap-3 sm:flex-1">
      <div className="relative w-full sm:w-48">
        <Input
          type="number"
          min={1}
          className="w-full pr-24 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={value}
          aria-label={t("servers:schedules.dialog.sleepSeconds")}
          onChange={(event) =>
            onChange(Math.max(1, Number(event.target.value) || 1))
          }
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {t("servers:schedules.dialog.sleepUnit", { count: value })}
        </span>
      </div>
      {hint ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("servers:schedules.dialog.sleepHint", { duration: hint })}
        </span>
      ) : null}
    </div>
  );
}

function TaskInput({
  task,
  backupLimit,
  canDeleteBackups,
  onChange,
}: {
  task: ScheduleTask;
  backupLimit: number | null;
  canDeleteBackups: boolean;
  onChange: (task: ScheduleTask) => void;
}) {
  const { t } = useTranslation();

  switch (task.type) {
    case "sleep":
      return (
        <SleepTaskField
          value={task.time}
          onChange={(time) => onChange({ type: "sleep", time })}
        />
      );
    case "terminal":
    case "minecraft":
      return (
        <Input
          className="w-full font-mono sm:flex-1"
          value={task.command}
          placeholder={t(`servers:schedules.dialog.${task.type}Placeholder`)}
          autoComplete="off"
          onChange={(event) =>
            onChange({ type: task.type, command: event.target.value })
          }
        />
      );
    case "backup":
    case "prune":
      return (
        <RetentionTaskField
          task={task}
          backupLimit={backupLimit}
          canDeleteBackups={canDeleteBackups}
          onChange={onChange}
        />
      );
    case "container":
      return (
        <Input
          className="w-full font-mono sm:flex-1"
          value={task.command.join(" ")}
          placeholder={t("servers:schedules.dialog.containerPlaceholder")}
          autoComplete="off"
          onChange={(event) =>
            onChange({
              type: "container",
              command: event.target.value
                .split(/\s+/)
                .filter((part) => part.length > 0),
            })
          }
        />
      );
    default:
      return (
        <span className="flex-1 text-xs text-muted-foreground">
          {t(`servers:schedules.taskHelp.${task.type}`)}
        </span>
      );
  }
}

export function TaskList({
  tasks,
  onChange,
  isAvailable,
  backupLimit,
  canDeleteBackups,
}: {
  tasks: ScheduleTask[];
  onChange: (tasks: ScheduleTask[]) => void;
  isAvailable: (type: TaskType) => boolean;
  backupLimit: number | null;
  canDeleteBackups: boolean;
}) {
  const { t } = useTranslation();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggableIndex, setDraggableIndex] = useState<number | null>(null);

  const setTask = (index: number, task: ScheduleTask) => {
    onChange(
      tasks.map((entry, position) => (position === index ? task : entry)),
    );
  };

  const moveTask = (from: number, to: number) => {
    if (to < 0 || to >= tasks.length || from === to) return;

    const next = [...tasks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
    setDraggableIndex(null);
  };

  const dragProps = (index: number) => ({
    draggable: draggableIndex === index,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      setDragIndex(index);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (dragIndex === null) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropIndex(index);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (dragIndex === null) return;

      event.preventDefault();
      moveTask(dragIndex, index);
      endDrag();
    },
    onDragEnd: endDrag,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{t("servers:schedules.dialog.tasksLabel")}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...tasks, emptyTask("restart")])}
        >
          <Plus className="size-4" />
          {t("servers:schedules.dialog.addTask")}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {tasks.map((task, index) => {
          const types = TASK_TYPES.filter(
            (type) => type === task.type || isAvailable(type),
          );
          const items = types.map((type) => ({
            value: type,
            label: t(`servers:schedules.taskTypes.${type}`),
          }));

          return (
            <div
              key={`${task.type}-${index}`}
              {...dragProps(index)}
              className={cn(
                "flex flex-col gap-2 rounded-md border p-3 transition-colors sm:flex-row sm:items-center",
                dragIndex === index && "opacity-50",
                dropIndex === index && dragIndex !== index && "border-primary",
              )}
            >
              <button
                type="button"
                aria-label={t("servers:schedules.dialog.reorder", {
                  position: index + 1,
                  total: tasks.length,
                })}
                className="cursor-grab self-start text-muted-foreground hover:text-foreground active:cursor-grabbing sm:self-auto"
                onMouseDown={() => setDraggableIndex(index)}
                onMouseUp={() => setDraggableIndex(null)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveTask(index, index - 1);
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveTask(index, index + 1);
                  }
                }}
              >
                <GripVertical className="size-4" />
              </button>

              <Select
                items={items}
                value={task.type}
                onValueChange={(value) =>
                  value && setTask(index, emptyTask(value))
                }
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <TaskInput
                task={task}
                backupLimit={backupLimit}
                canDeleteBackups={canDeleteBackups}
                onChange={(next) => setTask(index, next)}
              />

              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={tasks.length === 1}
                aria-label={t("common:actions.remove")}
                onClick={() =>
                  onChange(
                    tasks.filter((_entry, position) => position !== index),
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("servers:schedules.dialog.tasksHelp")}
      </p>
    </div>
  );
}
