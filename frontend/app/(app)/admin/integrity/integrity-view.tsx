"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Info,
  Loader2,
  Network,
  Play,
  ServerCog,
  SkipForward,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  integrityReport,
  integritySchema,
  runIntegrityChecks,
  type IntegrityCheckResult,
  type IntegrityFinding,
  type IntegrityReportResponse,
  type IntegritySchemaResponse,
  type IntegritySeverity,
  type IntegritySource,
  type IntegritySourceReport,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const severityOrder: Record<IntegritySeverity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  error: 3,
};

const severityStyles: Record<IntegritySeverity, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  info: "text-sky-600 dark:text-sky-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

function SeverityIcon({
  severity,
  className,
}: {
  severity: IntegritySeverity;
  className?: string;
}) {
  const merged = cn("size-4 shrink-0", severityStyles[severity], className);
  if (severity === "error") return <XCircle className={merged} />;
  if (severity === "warning") return <AlertTriangle className={merged} />;
  if (severity === "info") return <Info className={merged} />;
  return <CheckCircle2 className={merged} />;
}

function sourceKey(source: IntegritySource) {
  return source.kind === "backend" ? "backend" : `${source.kind}:${source.id}`;
}

function SourceIcon({ source }: { source: IntegritySource }) {
  if (source.kind === "node") return <Network className="size-4" />;
  if (source.kind === "database_host") return <Database className="size-4" />;
  return <ServerCog className="size-4" />;
}

function useSourceLabel() {
  const { t } = useTranslation();
  return (source: IntegritySource) => {
    if (source.kind === "backend") return t("admin-integrity:sources.backend");
    if (source.kind === "node")
      return t("admin-integrity:sources.node", { name: source.display });
    return t("admin-integrity:sources.databaseHost", { name: source.display });
  };
}

function FindingRow({ finding }: { finding: IntegrityFinding }) {
  const { t } = useTranslation();
  const entries = Object.entries(finding.details ?? {});
  const definition = finding.details?.definition;
  const rest = entries.filter(([key]) => key !== "definition");

  return (
    <li className="flex gap-2 border-t border-border/60 py-2 first:border-t-0">
      <SeverityIcon severity={finding.severity} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">{finding.message}</p>
        {finding.subject ? (
          <code className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {finding.subject}
          </code>
        ) : null}
        {rest.length > 0 ? (
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {rest.map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <dt className="font-medium">{key}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {definition ? (
          <div className="relative">
            <pre className="max-h-72 overflow-auto rounded bg-muted p-3 font-mono text-xs">
              {definition}
            </pre>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1 size-7"
              onClick={() => {
                void navigator.clipboard.writeText(definition);
                toast.success(t("common:actions.copied"));
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CheckRow({ check }: { check: IntegrityCheckResult }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60">
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        {check.skipped ? (
          <SkipForward className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <SeverityIcon severity={check.severity} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {check.title}
        </span>
        {check.deep ? (
          <Badge variant="outline" className="hidden sm:inline-flex">
            {t("admin-integrity:check.deep")}
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">
          {check.skipped
            ? t("admin-integrity:check.skipped")
            : t("admin-integrity:check.findings", {
                count: check.findings.length,
              })}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-2 pb-3 pl-8">
        <p className="text-xs text-muted-foreground">{check.description}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {check.id} · {t("admin-integrity:check.duration", {
            ms: check.duration_ms,
          })}
        </p>
        {check.skipped ? (
          <p className="text-sm text-muted-foreground">{check.skipped}</p>
        ) : check.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin-integrity:check.clean")}
          </p>
        ) : (
          <ul>
            {check.findings.map((finding, index) => (
              <FindingRow key={index} finding={finding} />
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceCard({
  report,
  onlyProblems,
}: {
  report: IntegritySourceReport;
  onlyProblems: boolean;
}) {
  const { t } = useTranslation();
  const label = useSourceLabel();

  const checks = (report.report?.checks ?? []).filter((check) =>
    onlyProblems ? severityOrder[check.severity] >= severityOrder.warning : true,
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <SourceIcon source={report.source} />
            <span className="truncate">{label(report.source)}</span>
          </CardTitle>
          {report.report ? (
            <CardDescription className="font-mono text-xs">
              {report.report.version} ·{" "}
              {new Date(report.report.generated).toLocaleString()}
            </CardDescription>
          ) : null}
        </div>
        <Badge
          variant={
            report.severity === "error"
              ? "destructive"
              : report.severity === "warning"
                ? "secondary"
                : "outline"
          }
        >
          {t(`admin-integrity:severity.${report.severity}`)}
        </Badge>
      </CardHeader>
      <CardContent>
        {report.error ? (
          <p className="text-sm text-destructive">{report.error}</p>
        ) : checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {onlyProblems
              ? t("admin-integrity:report.noProblems")
              : t("admin-integrity:report.noChecks")}
          </p>
        ) : (
          <div className="-mx-2">
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SchemaTab() {
  const { t } = useTranslation();
  const label = useSourceLabel();

  const { data, isLoading } = useSWR<IntegritySchemaResponse>(
    "admin/integrity/schema",
    async () => {
      const response = await integritySchema();
      if (response.error) throw new Error(t("common:state.genericError"));
      return response.data ?? [];
    },
  );

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("common:state.loading")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(data ?? []).map((entry) => (
        <Card key={sourceKey(entry.source)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SourceIcon source={entry.source} />
              <span className="truncate">{label(entry.source)}</span>
            </CardTitle>
            {entry.schema ? (
              <CardDescription className="font-mono text-xs">
                {entry.schema.engine} · {entry.schema.database} ·{" "}
                {t("admin-integrity:schema.tables", {
                  count: entry.schema.tables.length,
                })}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {entry.error ? (
              <p className="text-sm text-destructive">{entry.error}</p>
            ) : (
              (entry.schema?.tables ?? []).map((table) => (
                <div key={table.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-medium">
                      {table.name}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(table.definition);
                        toast.success(t("common:actions.copied"));
                      }}
                    >
                      <Copy className="size-3.5" />
                      {t("common:actions.copy")}
                    </Button>
                  </div>
                  <pre className="max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-xs">
                    {table.definition}
                  </pre>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function IntegrityView() {
  const { t } = useTranslation();
  const [deep, setDeep] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [starting, setStarting] = useState(false);

  const { data: run, mutate } = useSWR<IntegrityReportResponse>(
    "admin/integrity",
    async () => {
      const response = await integrityReport();
      if (response.error) throw new Error(t("common:state.genericError"));
      return response.data as IntegrityReportResponse;
    },
    { refreshInterval: (latest) => (latest?.state === "running" ? 2000 : 0) },
  );

  const running = run?.state === "running";

  const counts = useMemo(() => {
    const totals = { error: 0, warning: 0, info: 0 };
    for (const report of run?.reports ?? []) {
      for (const check of report.report?.checks ?? []) {
        for (const finding of check.findings) {
          if (finding.severity in totals) {
            totals[finding.severity as keyof typeof totals] += 1;
          }
        }
      }
    }
    return totals;
  }, [run]);

  async function start() {
    setStarting(true);
    const response = await runIntegrityChecks({ body: { checks: null, deep } });
    setStarting(false);

    if (response.error) {
      toast.error(t("admin-integrity:run.failed"));
      return;
    }
    toast.success(t("admin-integrity:run.started"));
    void mutate();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">
            {t("admin-integrity:title")}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("admin-integrity:description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="integrity-deep"
              checked={deep}
              onCheckedChange={setDeep}
              disabled={running}
            />
            <Label htmlFor="integrity-deep" className="text-sm font-normal">
              {t("admin-integrity:run.deep")}
            </Label>
          </div>
          <Button onClick={() => void start()} disabled={running || starting}>
            {running || starting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {running
              ? t("admin-integrity:run.running")
              : t("admin-integrity:run.start")}
          </Button>
        </div>
      </div>

      {run && run.state !== "idle" ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <SeverityIcon severity={run.severity} className="size-5" />
              <span className="text-sm font-medium">
                {t(`admin-integrity:overall.${run.severity}`)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("admin-integrity:overall.counts", {
                  errors: counts.error,
                  warnings: counts.warning,
                })}
              </span>
              {run.finished_at ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {t("admin-integrity:overall.finished", {
                    time: new Date(run.finished_at * 1000).toLocaleString(),
                  })}
                </span>
              ) : null}
            </div>
            {running ? (
              <div className="space-y-1">
                <Progress
                  value={run.total > 0 ? (run.done / run.total) * 100 : 0}
                />
                <p className="text-xs text-muted-foreground">
                  {run.step} · {run.done}/{run.total}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="checks">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="checks">
              {t("admin-integrity:tabs.checks")}
            </TabsTrigger>
            <TabsTrigger value="schema">
              {t("admin-integrity:tabs.schema")}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Switch
              id="integrity-only-problems"
              checked={onlyProblems}
              onCheckedChange={setOnlyProblems}
            />
            <Label
              htmlFor="integrity-only-problems"
              className="text-sm font-normal"
            >
              {t("admin-integrity:filter.onlyProblems")}
            </Label>
          </div>
        </div>

        <TabsContent value="checks" className="mt-4 flex flex-col gap-4">
          {!run || run.reports.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t("admin-integrity:empty")}
              </CardContent>
            </Card>
          ) : (
            run.reports.map((report) => (
              <SourceCard
                key={sourceKey(report.source)}
                report={report}
                onlyProblems={onlyProblems}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="schema" className="mt-4">
          <SchemaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
