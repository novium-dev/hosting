"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatMib } from "@/lib/server-status";
import { useServerStatsHistory } from "@/stores/server-stats";

const CPU_PERCENT_PER_CORE = 100;

type GraphPoint = {
  at: number;
  cpu: number | null;
  ram: number | null;
};

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatPercent(value: number) {
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function ServerResourceGraphs({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const history = useServerStatsHistory(serverId);

  const points = useMemo<GraphPoint[]>(
    () =>
      history.map((sample) => ({
        at: sample.at,
        cpu: sample.cpu === null ? null : sample.cpu * CPU_PERCENT_PER_CORE,
        ram: sample.ram,
      })),
    [history],
  );

  const latest = history[history.length - 1] ?? null;
  const cpuLimit =
    latest?.cpuMax == null || latest.cpuMax <= 0
      ? null
      : latest.cpuMax * CPU_PERCENT_PER_CORE;
  const ramLimit =
    latest?.ramMax == null || latest.ramMax <= 0 ? null : latest.ramMax;

  const cpuConfig = {
    cpu: { label: t("common:resources.cpu"), color: "var(--chart-1)" },
  } satisfies ChartConfig;

  const ramConfig = {
    ram: { label: t("common:resources.memory"), color: "var(--chart-4)" },
  } satisfies ChartConfig;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ResourceGraph
        title={t("common:resources.cpu")}
        value={
          latest?.cpu == null
            ? "--"
            : formatPercent(latest.cpu * CPU_PERCENT_PER_CORE)
        }
        limit={
          cpuLimit === null
            ? t("servers:graphs.unlimited")
            : t("servers:graphs.limit", { limit: formatPercent(cpuLimit) })
        }
        config={cpuConfig}
        dataKey="cpu"
        points={points}
        max={cpuLimit}
        formatValue={formatPercent}
      />
      <ResourceGraph
        title={t("common:resources.memory")}
        value={latest?.ram == null ? "--" : formatMib(latest.ram)}
        limit={
          ramLimit === null
            ? t("servers:graphs.unlimited")
            : t("servers:graphs.limit", { limit: formatMib(ramLimit) })
        }
        config={ramConfig}
        dataKey="ram"
        points={points}
        max={ramLimit}
        formatValue={formatMib}
      />
    </div>
  );
}

function ResourceGraph({
  title,
  value,
  limit,
  config,
  dataKey,
  points,
  max,
  formatValue,
}: {
  title: string;
  value: string;
  limit: string;
  config: ChartConfig;
  dataKey: "cpu" | "ram";
  points: GraphPoint[];
  max: number | null;
  formatValue: (value: number) => string;
}) {
  const { t } = useTranslation();

  return (
    <Card className="gap-0 border-border/70 p-0">
      <CardHeader className="flex flex-row items-baseline justify-between gap-2 border-b px-4 py-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tabular-nums">{value}</span>
          <span className="text-xs text-muted-foreground">{limit}</span>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        {points.length === 0 ? (
          <div className="flex h-[9rem] items-center justify-center text-xs text-muted-foreground">
            {t("servers:graphs.waiting")}
          </div>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-[9rem] w-full"
          >
            <AreaChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient
                  id={`fill-${dataKey}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={`var(--color-${dataKey})`}
                    stopOpacity={0.6}
                  />
                  <stop
                    offset="95%"
                    stopColor={`var(--color-${dataKey})`}
                    stopOpacity={0.05}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="at"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
                tickMargin={8}
                tickFormatter={formatTime}
              />
              <YAxis
                width={52}
                tickLine={false}
                axisLine={false}
                tickCount={4}
                domain={[0, max ?? "auto"]}
                tickFormatter={(tick: number) => formatValue(tick)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      formatTime(Number(payload[0]?.payload?.at ?? Date.now()))
                    }
                    formatter={(item) => formatValue(Number(item))}
                  />
                }
              />
              <Area
                dataKey={dataKey}
                type="monotone"
                stroke={`var(--color-${dataKey})`}
                strokeWidth={2}
                fill={`url(#fill-${dataKey})`}
                isAnimationActive={false}
                connectNulls
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
