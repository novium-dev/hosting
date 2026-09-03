import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  FileQuestion,
  Power,
  PowerOff,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import {
  PROVIDER_LABELS,
  RESOURCE_TYPE_LABELS,
  type InstalledResource,
  type ResourceUpdate,
  type UnmanagedResource,
} from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";
import {
  ProjectTitleLink,
  canMutate,
  formatSize,
  installKey,
  type ModsContext,
} from "./shared";

type InstalledPanelProps = {
  ctx: ModsContext;
  installed: InstalledResource[];
  unmanaged: UnmanagedResource[];
  unreadable: string[];
  updates: ResourceUpdate[];
  allowPrerelease: boolean;
  onAllowPrereleaseChange: (value: boolean) => void;
  onUpdate: (entry: InstalledResource) => void;
  onUpdateAll: () => void;
  onToggle: (
    resourceType: string,
    file: string,
    label: string,
    enabled: boolean,
  ) => void;
  onUninstall: (entry: InstalledResource) => void;
};

export function InstalledPanel({
  ctx,
  installed,
  unmanaged,
  unreadable,
  updates,
  allowPrerelease,
  onAllowPrereleaseChange,
  onUpdate,
  onUpdateAll,
  onToggle,
  onUninstall,
}: InstalledPanelProps) {
  const { t } = useTranslation();

  const updateByProject = useMemo(
    () =>
      new Map(
        updates.map((entry) => [
          installKey(entry.provider, entry.project),
          entry,
        ]),
      ),
    [updates],
  );

  const writable = canMutate(ctx);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              {t("servers-management:mods.installed.title")}
              {updates.length > 0 ? (
                <Badge className="gap-1 border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
                  <ArrowUpCircle className="size-3" />
                  {t("servers-management:mods.installed.updatesBadge", {
                    count: updates.length,
                  })}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {installed.length === 0
                ? t("servers-management:mods.installed.empty")
                : t("servers-management:mods.installed.count", {
                    count: installed.length,
                  })}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {installed.length > 0 ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="installed-prerelease"
                  checked={allowPrerelease}
                  onCheckedChange={onAllowPrereleaseChange}
                />
                <Label
                  htmlFor="installed-prerelease"
                  className="text-sm font-normal text-muted-foreground"
                >
                  {t("servers-management:mods.includeBeta")}
                </Label>
              </div>
            ) : null}
            {updates.length > 0 ? (
              <Button size="sm" disabled={!writable} onClick={onUpdateAll}>
                <ArrowUpCircle data-icon="inline-start" />
                {t("servers-management:mods.installed.updateAllButton")}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        {installed.length > 0 ? (
          <CardContent className="flex flex-col gap-2">
            <TaskLockNotice lock={ctx.storageLock} />
            {installed.map((entry) => {
              const update = updateByProject.get(
                installKey(entry.provider, entry.project),
              );

              return (
                <div
                  key={installKey(entry.provider, entry.project)}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <ProjectTitleLink
                        href={entry.page_url}
                        title={entry.title}
                        className={cn(entry.enabled || "text-muted-foreground")}
                      />
                      <Badge variant="secondary">
                        {PROVIDER_LABELS[entry.provider]}
                      </Badge>
                      {entry.enabled ? null : (
                        <Badge variant="outline">
                          {t("common:status.disabled")}
                        </Badge>
                      )}
                      {update ? (
                        <Badge className="gap-1 border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
                          <ArrowUpCircle className="size-3" />
                          {update.latest_version_number}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {entry.file_name}
                      {entry.enabled ? "" : ".disabled"}
                    </span>
                  </div>

                  <span className="flex items-center gap-2">
                    {update ? (
                      <Button
                        size="sm"
                        disabled={!writable || update.downloadable === false}
                        onClick={() => onUpdate(entry)}
                      >
                        <ArrowUpCircle data-icon="inline-start" />
                        {t("common:actions.update")}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!writable}
                      onClick={() =>
                        onToggle(
                          entry.resource_type,
                          entry.file_name,
                          entry.title,
                          !entry.enabled,
                        )
                      }
                    >
                      {entry.enabled ? (
                        <PowerOff data-icon="inline-start" />
                      ) : (
                        <Power data-icon="inline-start" />
                      )}
                      {entry.enabled
                        ? t("servers-management:mods.actions.disable")
                        : t("servers-management:mods.actions.enable")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!writable}
                      onClick={() => onUninstall(entry)}
                    >
                      <Trash2 data-icon="inline-start" />
                      {t("common:actions.remove")}
                    </Button>
                  </span>
                </div>
              );
            })}
          </CardContent>
        ) : null}
      </Card>

      {unmanaged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileQuestion className="size-5" />
              {t("servers-management:mods.unmanaged.title")}
            </CardTitle>
            <CardDescription>
              {t("servers-management:mods.unmanaged.description", {
                count: unmanaged.length,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {unmanaged.map((entry) => (
              <div
                key={`${entry.resource_type}:${entry.file_name}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3"
              >
                <span
                  className={cn(
                    "truncate font-medium",
                    entry.enabled || "text-muted-foreground",
                  )}
                >
                  {entry.file_name}
                </span>
                <span className="flex items-center gap-2">
                  {entry.enabled ? null : (
                    <Badge variant="outline">
                      {t("common:status.disabled")}
                    </Badge>
                  )}
                  <Badge variant="outline">
                    {RESOURCE_TYPE_LABELS[entry.resource_type] ??
                      entry.resource_type}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatSize(entry.size)}
                  </span>
                  {entry.resource_type === "data_pack" ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!writable}
                      onClick={() =>
                        onToggle(
                          entry.resource_type,
                          entry.file_name,
                          entry.file_name,
                          !entry.enabled,
                        )
                      }
                    >
                      {entry.enabled ? (
                        <PowerOff data-icon="inline-start" />
                      ) : (
                        <Power data-icon="inline-start" />
                      )}
                      {entry.enabled
                        ? t("servers-management:mods.actions.disable")
                        : t("servers-management:mods.actions.enable")}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {unreadable.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5" />
              {t("servers-management:mods.unreadable.title")}
            </CardTitle>
            <CardDescription>
              {t("servers-management:mods.unreadable.description", {
                types: unreadable
                  .map((type) => RESOURCE_TYPE_LABELS[type] ?? type)
                  .join(", "),
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
