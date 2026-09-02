/**
 * Cron helpers matching the `cron` crate the nodes evaluate schedules with.
 *
 * Two of its conventions differ from the cron most people have in their
 * fingers, and both are handled here rather than left to the user:
 * expressions carry a leading seconds field, and days of the week run 1-7
 * with Sunday as 1, so a plain `0` is not a valid weekday.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 1,
  sunday: 1,
  mon: 2,
  monday: 2,
  tue: 3,
  tues: 3,
  tuesday: 3,
  wed: 4,
  wednesday: 4,
  thu: 5,
  thurs: 5,
  thursday: 5,
  fri: 6,
  friday: 6,
  sat: 7,
  saturday: 7,
};

export type CronFieldKey =
  | "second"
  | "minute"
  | "hour"
  | "dayOfMonth"
  | "month"
  | "dayOfWeek";

export type CronFieldSpec = {
  key: CronFieldKey;
  min: number;
  max: number;
  names?: Record<string, number>;
};

export const CRON_FIELDS: CronFieldSpec[] = [
  { key: "second", min: 0, max: 59 },
  { key: "minute", min: 0, max: 59 },
  { key: "hour", min: 0, max: 23 },
  { key: "dayOfMonth", min: 1, max: 31 },
  { key: "month", min: 1, max: 12, names: MONTH_NAMES },
  { key: "dayOfWeek", min: 1, max: 7, names: WEEKDAY_NAMES },
];

/** Weekdays in the order a European week is read, with the crate's ordinals. */
export const WEEKDAYS = [
  { ordinal: 2, key: "mon" },
  { ordinal: 3, key: "tue" },
  { ordinal: 4, key: "wed" },
  { ordinal: 5, key: "thu" },
  { ordinal: 6, key: "fri" },
  { ordinal: 7, key: "sat" },
  { ordinal: 1, key: "sun" },
] as const;

function ordinal(token: string, spec: CronFieldSpec): number | null {
  const named = spec.names?.[token.toLowerCase()];
  if (named !== undefined) return named;

  if (!/^\d+$/.test(token)) return null;

  const value = Number(token);
  return value >= spec.min && value <= spec.max ? value : null;
}

/** Expands one field into the set of values it matches, or null when invalid. */
export function parseCronField(
  input: string,
  spec: CronFieldSpec,
): Set<number> | null {
  const field = input.trim();
  if (field.length === 0) return null;

  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [range, step] = part.split("/");
    if (step !== undefined && !/^\d+$/.test(step)) return null;

    const stride = step === undefined ? 1 : Number(step);
    if (stride < 1) return null;

    let from: number;
    let to: number;

    if (range === "*" || range === "?") {
      from = spec.min;
      to = spec.max;
    } else if (range.includes("-")) {
      const [start, end] = range.split("-");
      const parsedStart = ordinal(start, spec);
      const parsedEnd = ordinal(end, spec);
      if (parsedStart === null || parsedEnd === null || parsedStart > parsedEnd) {
        return null;
      }
      from = parsedStart;
      to = parsedEnd;
    } else {
      const single = ordinal(range, spec);
      if (single === null) return null;
      from = single;
      to = step === undefined ? single : spec.max;
    }

    for (let value = from; value <= to; value += stride) values.add(value);
  }

  return values.size > 0 ? values : null;
}

/** Splits an expression into its six fields, filling in a missing seconds field. */
export function cronFields(expression: string): string[] {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  return fields.length === 5 ? ["0", ...fields] : fields;
}

export function parseCron(expression: string): Set<number>[] | null {
  const fields = cronFields(expression);
  if (fields.length !== CRON_FIELDS.length) return null;

  const parsed: Set<number>[] = [];
  for (const [index, spec] of CRON_FIELDS.entries()) {
    const values = parseCronField(fields[index], spec);
    if (!values) return null;
    parsed.push(values);
  }

  return parsed;
}

/** The wall clock reading of an instant inside a timezone. */
function wallClock(timezone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // A midnight reading comes back as hour 24 in some engines.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

const MAX_DAYS_SCANNED = 366 * 4;

/**
 * The next times the expression fires, as wall clock readings in `timezone`.
 *
 * Each is returned as a `Date` whose UTC fields carry that wall clock, so it
 * formats correctly with `timeZone: "UTC"` and never needs offset arithmetic.
 */
export function nextCronRuns(
  expression: string,
  timezone: string,
  count: number,
  now: Date = new Date(),
): Date[] {
  const parsed = parseCron(expression);
  if (!parsed) return [];

  const [seconds, minutes, hours, daysOfMonth, months, daysOfWeek] = parsed;
  const restrictsWeekday = daysOfWeek.size < 7;

  let start: ReturnType<typeof wallClock>;
  try {
    start = wallClock(timezone, now);
  } catch {
    return [];
  }

  const runs: Date[] = [];
  let day = Date.UTC(start.year, start.month - 1, start.day);

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
    const date = new Date(day);
    const isFirstDay = scanned === 0;

    // The crate requires both day fields to match, rather than either of them.
    const weekdayMatches =
      !restrictsWeekday || daysOfWeek.has(date.getUTCDay() + 1);

    if (
      months.has(date.getUTCMonth() + 1) &&
      daysOfMonth.has(date.getUTCDate()) &&
      weekdayMatches
    ) {
      for (const hour of [...hours].sort((a, b) => a - b)) {
        if (isFirstDay && hour < start.hour) continue;

        for (const minute of [...minutes].sort((a, b) => a - b)) {
          if (isFirstDay && hour === start.hour && minute < start.minute) {
            continue;
          }

          for (const second of [...seconds].sort((a, b) => a - b)) {
            if (
              isFirstDay &&
              hour === start.hour &&
              minute === start.minute &&
              second <= start.second
            ) {
              continue;
            }

            runs.push(
              new Date(
                Date.UTC(
                  date.getUTCFullYear(),
                  date.getUTCMonth(),
                  date.getUTCDate(),
                  hour,
                  minute,
                  second,
                ),
              ),
            );

            if (runs.length >= count) return runs;
          }
        }
      }
    }

    day += 24 * 60 * 60 * 1000;
  }

  return runs;
}

export type SimpleSchedule =
  | { frequency: "hourly"; minute: number }
  | { frequency: "daily"; hour: number; minute: number }
  | { frequency: "weekly"; weekday: number; hour: number; minute: number }
  | { frequency: "monthly"; dayOfMonth: number; hour: number; minute: number };

export function buildCron(simple: SimpleSchedule): string {
  switch (simple.frequency) {
    case "hourly":
      return `0 ${simple.minute} * * * *`;
    case "daily":
      return `0 ${simple.minute} ${simple.hour} * * *`;
    case "weekly":
      return `0 ${simple.minute} ${simple.hour} * * ${simple.weekday}`;
    case "monthly":
      return `0 ${simple.minute} ${simple.hour} ${simple.dayOfMonth} * *`;
  }
}

/** Reads an expression back into the simple form, when it fits into one. */
export function toSimpleSchedule(expression: string): SimpleSchedule | null {
  const fields = cronFields(expression);
  if (fields.length !== 6) return null;

  const [second, minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const isNumber = (field: string) => /^\d+$/.test(field);

  if (second !== "0" || month !== "*" || !isNumber(minute)) return null;

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return { frequency: "hourly", minute: Number(minute) };
  }

  if (!isNumber(hour)) return null;

  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return { frequency: "daily", hour: Number(hour), minute: Number(minute) };
  }

  if (dayOfMonth === "*" && isNumber(dayOfWeek)) {
    return {
      frequency: "weekly",
      weekday: Number(dayOfWeek),
      hour: Number(hour),
      minute: Number(minute),
    };
  }

  if (isNumber(dayOfMonth) && dayOfWeek === "*") {
    return {
      frequency: "monthly",
      dayOfMonth: Number(dayOfMonth),
      hour: Number(hour),
      minute: Number(minute),
    };
  }

  return null;
}
