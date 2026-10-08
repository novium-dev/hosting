import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CRON_FIELDS,
  WEEKDAYS,
  buildCron,
  cronFields,
  nextCronRuns,
  parseCronField,
  toSimpleSchedule,
  type SimpleSchedule,
} from "@/lib/cron";
import { cn } from "@/lib/utils";
import {
  FREQUENCIES,
  PREVIEW_RUNS,
  clamp,
  formatWallClock,
  pad,
} from "./utils";

function withFrequency(
  simple: SimpleSchedule,
  frequency: SimpleSchedule["frequency"],
): SimpleSchedule {
  const { minute } = simple;
  const hour = "hour" in simple ? simple.hour : 4;

  switch (frequency) {
    case "hourly":
      return { frequency, minute };
    case "daily":
      return { frequency, hour, minute };
    case "weekly":
      return {
        frequency,
        weekday: "weekday" in simple ? simple.weekday : 2,
        hour,
        minute,
      };
    case "monthly":
      return {
        frequency,
        dayOfMonth: "dayOfMonth" in simple ? simple.dayOfMonth : 1,
        hour,
        minute,
      };
  }
}

function SimpleCronFields({
  simple,
  onChange,
}: {
  simple: SimpleSchedule;
  onChange: (next: SimpleSchedule) => void;
}) {
  const { t } = useTranslation();
  const frequencies = FREQUENCIES.map((frequency) => ({
    value: frequency,
    label: t(`servers:schedules.frequencies.${frequency}`),
  }));
  const weekdays = WEEKDAYS.map((weekday) => ({
    value: String(weekday.ordinal),
    label: t(`servers:schedules.weekdays.${weekday.key}`),
  }));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          {t("servers:schedules.dialog.frequency")}
        </Label>
        <Select
          items={frequencies}
          value={simple.frequency}
          onValueChange={(value) =>
            value && onChange(withFrequency(simple, value))
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {frequencies.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {simple.frequency === "weekly" ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {t("servers:schedules.cronFields.dayOfWeek")}
          </Label>
          <Select
            items={weekdays}
            value={String(simple.weekday)}
            onValueChange={(value) =>
              onChange({ ...simple, weekday: Number(value) })
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekdays.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {simple.frequency === "monthly" ? (
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="schedule-day-of-month"
            className="text-xs text-muted-foreground"
          >
            {t("servers:schedules.cronFields.dayOfMonth")}
          </Label>
          <Input
            id="schedule-day-of-month"
            type="number"
            min={1}
            max={31}
            className="w-[110px]"
            value={simple.dayOfMonth}
            onChange={(event) =>
              onChange({
                ...simple,
                dayOfMonth: clamp(Number(event.target.value), 1, 31),
              })
            }
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="schedule-time"
          className="text-xs text-muted-foreground"
        >
          {simple.frequency === "hourly"
            ? t("servers:schedules.cronFields.minute")
            : t("servers:schedules.dialog.time")}
        </Label>
        {simple.frequency === "hourly" ? (
          <Input
            id="schedule-time"
            type="number"
            min={0}
            max={59}
            className="w-[110px]"
            value={simple.minute}
            onChange={(event) =>
              onChange({
                ...simple,
                minute: clamp(Number(event.target.value), 0, 59),
              })
            }
          />
        ) : (
          <Input
            id="schedule-time"
            type="time"
            className="w-[140px]"
            value={`${pad(simple.hour)}:${pad(simple.minute)}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(":").map(Number);
              if (Number.isNaN(hour) || Number.isNaN(minute)) {
                return;
              }

              onChange({ ...simple, hour, minute });
            }}
          />
        )}
      </div>
    </div>
  );
}

export function CronEditor({
  cron,
  timezone,
  onChange,
}: {
  cron: string[];
  timezone: string;
  onChange: (cron: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const expression = cron.map((field) => field.trim()).join(" ");
  const simple = toSimpleSchedule(expression);
  const [mode, setMode] = useState(simple ? "simple" : "advanced");
  const preview = nextCronRuns(expression, timezone, PREVIEW_RUNS);

  return (
    <div className="flex flex-col gap-2">
      <Label>{t("servers:schedules.dialog.cronLabel")}</Label>
      <Tabs
        value={mode}
        onValueChange={(value) =>
          setMode(value === "advanced" ? "advanced" : "simple")
        }
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="simple">
            {t("servers:schedules.dialog.modeSimple")}
          </TabsTrigger>
          <TabsTrigger value="advanced">
            {t("servers:schedules.dialog.modeAdvanced")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="simple" className="pt-3">
          {simple ? (
            <SimpleCronFields
              simple={simple}
              onChange={(next) => onChange(cronFields(buildCron(next)))}
            />
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {t("servers:schedules.dialog.tooComplexForSimple")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="advanced" className="flex flex-col gap-2 pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {CRON_FIELDS.map((spec, index) => {
              const invalid = parseCronField(cron[index] ?? "", spec) === null;

              return (
                <div key={spec.key} className="flex flex-col gap-1">
                  <Label
                    htmlFor={`schedule-cron-${spec.key}`}
                    className="text-xs text-muted-foreground"
                  >
                    {t(`servers:schedules.cronFields.${spec.key}`)}
                  </Label>
                  <Input
                    id={`schedule-cron-${spec.key}`}
                    className={cn(
                      "font-mono",
                      invalid &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                    value={cron[index] ?? "*"}
                    autoComplete="off"
                    aria-invalid={invalid}
                    onChange={(event) =>
                      onChange(
                        cron.map((field, position) =>
                          position === index ? event.target.value : field,
                        ),
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("servers:schedules.dialog.cronHelp")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("servers:schedules.dialog.weekdayHelp")}
          </p>
        </TabsContent>
      </Tabs>

      <div className="rounded-md border p-3">
        <p className="text-xs font-medium">
          {t("servers:schedules.dialog.preview")}
        </p>
        {preview.length === 0 ? (
          <p className="mt-1 text-xs text-destructive">
            {t("servers:schedules.dialog.previewNone")}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5">
            {preview.map((run) => (
              <li
                key={run.toISOString()}
                className="text-xs text-muted-foreground"
              >
                {formatWallClock(run, i18n.language)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {expression} · {timezone}
        </p>
      </div>
    </div>
  );
}
