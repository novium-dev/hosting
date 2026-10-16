import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  Boxes,
  PackagePlus,
  Power,
  PowerOff,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  setResourceStateAction,
  uninstallResourceAction,
  updateAllResourcesAction,
  updateResourceAction,
} from "@/actions/mod-browser";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { TaskLockNotice } from "@/components/server/task-lock-notice";
import {
  PROVIDER_LABELS,
  RESOURCE_TYPE_LABELS,
  type InstalledModpack,
  type InstalledResource,
  type ModpackMod,
  type ResourceUpdate,
  type UnmanagedResource,
} from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";
import { ModpackCard } from "./modpack-card";
import type { ModpackTarget } from "./modpack-install-dialog";
import {
  ProjectIcon,
  ProjectTitleLink,
  canMutate,
  formatSize,
  installKey,
  type ModsContext,
} from "./shared";

type ResourceTypeName = "plugin" | "modification" | "data_pack";

type ContentRow = {
  key: string;
  title: string;
  fileName: string;
  resourceType: ResourceTypeName;
  enabled: boolean;
  installedAt: number | null;
  size: number | null;
  managed: InstalledResource | null;
  update: ResourceUpdate | null;
};

type SortOrder = "name" | "added";

type ContentPanelProps = {
  ctx: ModsContext;
  pack: InstalledModpack | null;
  installed: InstalledResource[];
  unmanaged: UnmanagedResource[];
  unreadable: string[];
  updates: ResourceUpdate[];
  allowPrerelease: boolean;
  onAllowPrereleaseChange: (value: boolean) => void;
  onChanged: () => Promise<unknown>;
  onBrowse: (kind: "resource" | "modpack") => void;
  onInstallPack: (target: ModpackTarget, version?: string) => void;
};

export function ContentPanel({
  ctx,
  pack,
  installed,
  unmanaged,
  unreadable,
  updates,
  allowPrerelease,
  onAllowPrereleaseChange,
  onChanged,
  onBrowse,
  onInstallPack,
}: ContentPanelProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortOrder>("name");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ContentRow[] | null>(null);

  const writable = canMutate(ctx) && !busy;
  const modpacksAvailable = ctx.modpackLoaders.length > 0;

  const rows = useMemo(() => {
    const updateByProject = new Map(
      updates.map((entry) => [
        installKey(entry.provider, entry.project),
        entry,
      ]),
    );
    const managedRows: ContentRow[] = installed.map((entry) => ({
      key: `managed:${installKey(entry.provider, entry.project)}`,
      title: entry.title,
      fileName: entry.enabled ? entry.file_name : `${entry.file_name}.disabled`,
      resourceType: entry.resource_type,
      enabled: entry.enabled,
      installedAt: entry.installed_at,
      size: null,
      managed: entry,
      update:
        updateByProject.get(installKey(entry.provider, entry.project)) ?? null,
    }));
    const uploadedRows: ContentRow[] = unmanaged.map((entry) => ({
      key: `file:${entry.resource_type}:${entry.file_name}`,
      title: entry.file_name.replace(/\.disabled$/i, ""),
      fileName: entry.file_name,
      resourceType: entry.resource_type,
      enabled: entry.enabled,
      installedAt: null,
      size: entry.size,
      managed: null,
      update: null,
    }));

    const needle = filter.trim().toLowerCase();
    const all = [...managedRows, ...uploadedRows].filter(
      (row) =>
        !needle ||
        row.title.toLowerCase().includes(needle) ||
        row.fileName.toLowerCase().includes(needle),
    );

    return all.sort((left, right) =>
      sort === "added"
        ? (right.installedAt ?? 0) - (left.installedAt ?? 0)
        : left.title.localeCompare(right.title),
    );
  }, [installed, unmanaged, updates, filter, sort]);

  const visibleKeys = new Set(rows.map((row) => row.key));
  const selectedRows = rows.filter((row) => selected.has(row.key));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const total = installed.length + unmanaged.length;

  const toggleSelected = (key: string, checked: boolean) => {
    const next = new Set(
      [...selected].filter((entry) => visibleKeys.has(entry)),
    );
    if (checked) next.add(key);
    else next.delete(key);
    setSelected(next);
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  const setEnabled = (targets: ContentRow[], enabled: boolean) =>
    run(async () => {
      let changed = 0;
      for (const row of targets) {
        if (row.enabled === enabled || row.resourceType === "data_pack") {
          continue;
        }
        const result = await setResourceStateAction({
          serverId: ctx.serverId,
          resourceType: row.resourceType,
          file: row.fileName,
          enabled,
        });
        if (result.serverError) {
          toast.error(`${row.title}: ${result.serverError}`);
        } else {
          changed += 1;
        }
      }
      if (changed > 0) {
        toast.success(
          enabled
            ? t("servers-management:mods.toasts.enabledCount", {
                count: changed,
              })
            : t("servers-management:mods.toasts.disabledCount", {
                count: changed,
              }),
        );
      }
      setSelected(new Set());
    });

  const updateRows = (targets: ContentRow[]) =>
    run(async () => {
      let changed = 0;
      for (const row of targets) {
        if (!row.managed || !row.update) continue;
        const result = await updateResourceAction({
          serverId: ctx.serverId,
          provider: row.managed.provider,
          project: row.managed.project,
          allowPrerelease,
        });
        if (result.serverError) {
          toast.error(`${row.title}: ${result.serverError}`);
        } else {
          changed += 1;
        }
      }
      if (changed > 0) {
        toast.success(
          t("servers-management:mods.toasts.updatedCount", { count: changed }),
        );
      }
      setSelected(new Set());
    });

  const updateAll = () =>
    run(async () => {
      const result = await updateAllResourcesAction({
        serverId: ctx.serverId,
        allowPrerelease,
      });
      if (result.serverError || !result.data) {
        toast.error(
          result.serverError ??
            t("servers-management:mods.toasts.updateFailed"),
        );
        return;
      }
      for (const entry of result.data.filter((item) => item.error)) {
        toast.error(`${entry.title}: ${entry.error}`);
      }
      const updated = result.data.filter((item) => item.version).length;
      if (updated > 0) {
        toast.success(
          t("servers-management:mods.toasts.updatedCount", { count: updated }),
        );
      }
    });

  const remove = (targets: ContentRow[]) =>
    run(async () => {
      let removed = 0;
      for (const row of targets) {
        if (!row.managed) continue;
        const result = await uninstallResourceAction({
          serverId: ctx.serverId,
          provider: row.managed.provider,
          project: row.managed.project,
        });
        if (result.serverError) {
          toast.error(`${row.title}: ${result.serverError}`);
        } else {
          removed += 1;
        }
      }
      if (removed > 0) {
        toast.success(
          t("servers-management:mods.toasts.removedCount", { count: removed }),
        );
      }
      setSelected(new Set());
    });

  const togglePackMod = async (entry: ModpackMod) => {
    const result = await setResourceStateAction({
      serverId: ctx.serverId,
      resourceType: entry.resource_type,
      file: entry.file_name,
      enabled: !entry.enabled,
    });
    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }
    await onChanged();
  };

  const removable = selectedRows.filter((row) => row.managed);
  const updatable = selectedRows.filter((row) => row.update);

  return (
    <div className="flex flex-col gap-6">
      {pack ? (
        <ModpackCard
          ctx={ctx}
          pack={pack}
          onInstall={onInstallPack}
          onUnlinked={() => void onChanged()}
          onToggleMod={togglePackMod}
        />
      ) : modpacksAvailable ? (
        <Card className="border-dashed">
          <CardHeader className="flex flex-wrap items-center gap-4">
            <span className="flex size-12 items-center justify-center rounded-md bg-muted">
              <Boxes className="size-6 text-muted-foreground" />
            </span>
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
              <CardTitle>
                {t("servers-management:mods.pack.emptyTitle")}
              </CardTitle>
              <CardDescription>
                {t("servers-management:mods.pack.emptyDescription")}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => onBrowse("modpack")}>
              {t("servers-management:mods.pack.browseButton")}
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              {pack
                ? t("servers-management:mods.content.addedTitle")
                : t("servers-management:mods.content.title")}
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
              {total === 0
                ? pack
                  ? t("servers-management:mods.content.emptyWithPack")
                  : t("servers-management:mods.content.empty")
                : t("servers-management:mods.content.count", { count: total })}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {updates.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!writable}
                onClick={() => void updateAll()}
              >
                <ArrowUpCircle data-icon="inline-start" />
                {t("servers-management:mods.installed.updateAllButton")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => onBrowse("resource")}>
              <PackagePlus data-icon="inline-start" />
              {t("servers-management:mods.content.addButton")}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <TaskLockNotice lock={ctx.storageLock} />

          {total > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="pl-9"
                  placeholder={t(
                    "servers-management:mods.content.filterPlaceholder",
                  )}
                />
              </div>
              <Select
                items={[
                  {
                    value: "name",
                    label: t("servers-management:mods.content.sortName"),
                  },
                  {
                    value: "added",
                    label: t("servers-management:mods.content.sortAdded"),
                  },
                ]}
                value={sort}
                onValueChange={(value) => setSort(value as SortOrder)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">
                    {t("servers-management:mods.content.sortName")}
                  </SelectItem>
                  <SelectItem value="added">
                    {t("servers-management:mods.content.sortAdded")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch
                  id="content-prerelease"
                  checked={allowPrerelease}
                  onCheckedChange={onAllowPrereleaseChange}
                />
                <Label
                  htmlFor="content-prerelease"
                  className="text-sm font-normal text-muted-foreground"
                >
                  {t("servers-management:mods.includeBeta")}
                </Label>
              </div>
            </div>
          ) : null}

          {selectedRows.length > 0 ? (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 pl-3 shadow-sm">
              <span className="mr-auto text-sm font-medium">
                {t("servers-management:mods.content.selected", {
                  count: selectedRows.length,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!writable}
                onClick={() => void setEnabled(selectedRows, true)}
              >
                <Power data-icon="inline-start" />
                {t("servers-management:mods.actions.enable")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!writable}
                onClick={() => void setEnabled(selectedRows, false)}
              >
                <PowerOff data-icon="inline-start" />
                {t("servers-management:mods.actions.disable")}
              </Button>
              {updatable.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!writable}
                  onClick={() => void updateRows(updatable)}
                >
                  <ArrowUpCircle data-icon="inline-start" />
                  {t("common:actions.update")}
                </Button>
              ) : null}
              {removable.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!writable}
                  onClick={() => setRemoving(removable)}
                >
                  <Trash2 data-icon="inline-start" />
                  {t("common:actions.remove")}
                </Button>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("servers-management:mods.content.clearSelection")}
                onClick={() => setSelected(new Set())}
              >
                <X />
              </Button>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-3 px-3 py-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked ? new Set(rows.map((row) => row.key)) : new Set(),
                    )
                  }
                />
                {t("servers-management:mods.content.selectAll")}
              </label>
              {rows.map((row) => (
                <ContentRowItem
                  key={row.key}
                  row={row}
                  selected={selected.has(row.key)}
                  writable={writable}
                  onSelect={(checked) => toggleSelected(row.key, checked)}
                  onToggle={() => void setEnabled([row], !row.enabled)}
                  onUpdate={() => void updateRows([row])}
                  onRemove={() => setRemoving([row])}
                />
              ))}
            </div>
          ) : total > 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {t("servers-management:mods.content.noMatches")}
            </p>
          ) : null}
        </CardContent>
      </Card>

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

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers-management:mods.content.removeConfirm.title", {
                count: removing?.length ?? 0,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(removing ?? []).map((row) => row.title).join(", ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const targets = removing ?? [];
                setRemoving(null);
                void remove(targets);
              }}
            >
              {t("common:actions.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type ContentRowItemProps = {
  row: ContentRow;
  selected: boolean;
  writable: boolean;
  onSelect: (checked: boolean) => void;
  onToggle: () => void;
  onUpdate: () => void;
  onRemove: () => void;
};

function ContentRowItem({
  row,
  selected,
  writable,
  onSelect,
  onToggle,
  onUpdate,
  onRemove,
}: ContentRowItemProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border p-2 pl-3 transition-colors",
        selected && "border-primary/50 bg-primary/5",
        !row.managed && "border-dashed",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onSelect(checked === true)}
        aria-label={row.title}
      />
      <ProjectIcon title={row.title} className="size-9" />

      <div className="flex min-w-0 flex-1 basis-48 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <ProjectTitleLink
            href={row.managed?.page_url}
            title={row.title}
            className={cn(
              "font-medium",
              row.enabled || "text-muted-foreground",
            )}
          />
          {row.managed ? (
            <Badge variant="secondary">
              {PROVIDER_LABELS[row.managed.provider]}
            </Badge>
          ) : (
            <Badge variant="outline">
              {t("servers-management:mods.content.uploadedBadge")}
            </Badge>
          )}
          {row.resourceType === "modification" ? null : (
            <Badge variant="outline">
              {RESOURCE_TYPE_LABELS[row.resourceType] ?? row.resourceType}
            </Badge>
          )}
          {row.enabled ? null : (
            <Badge variant="outline">{t("common:status.disabled")}</Badge>
          )}
          {row.update ? (
            <Badge className="gap-1 border-sky-200 bg-sky-100 text-sky-800 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
              <ArrowUpCircle className="size-3" />
              {row.update.latest_version_number}
            </Badge>
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {row.fileName}
          {row.size !== null ? ` · ${formatSize(row.size)}` : ""}
        </span>
      </div>

      <span className="flex items-center gap-2">
        {row.update ? (
          <Button
            size="sm"
            disabled={!writable || row.update.downloadable === false}
            onClick={onUpdate}
          >
            <ArrowUpCircle data-icon="inline-start" />
            {t("common:actions.update")}
          </Button>
        ) : null}
        <Switch
          checked={row.enabled}
          disabled={!writable || row.resourceType === "data_pack"}
          aria-label={
            row.enabled
              ? t("servers-management:mods.actions.disable")
              : t("servers-management:mods.actions.enable")
          }
          onCheckedChange={onToggle}
        />
        {row.managed ? (
          <Button
            variant="ghost"
            size="icon"
            disabled={!writable}
            aria-label={t("common:actions.remove")}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        ) : (
          <span className="size-9" />
        )}
      </span>
    </div>
  );
}
