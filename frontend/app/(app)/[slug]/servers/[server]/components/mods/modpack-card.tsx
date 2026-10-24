import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  EllipsisVertical,
  History,
  ListTree,
  RefreshCw,
  RotateCcw,
  Search,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import {
  modpackVersionsAction,
  unlinkModpackAction,
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  PROVIDER_LABELS,
  type InstalledModpack,
  type ModpackMod,
} from "@/lib/mod-browser/types";
import { cn } from "@/lib/utils";
import type { ModpackTarget } from "./modpack-install-dialog";
import {
  LOADER_NAMES,
  ProjectIcon,
  ProjectTitleLink,
  canMutate,
  formatTimestamp,
  type ModsContext,
} from "./shared";

type ModpackCardProps = {
  ctx: ModsContext;
  pack: InstalledModpack;
  onInstall: (target: ModpackTarget, version?: string) => void;
  onUnlinked: () => void;
  onToggleMod: (entry: ModpackMod) => Promise<void>;
};

export function ModpackCard({
  ctx,
  pack,
  onInstall,
  onUnlinked,
  onToggleMod,
}: ModpackCardProps) {
  const { t } = useTranslation();
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const {
    data: versions,
    isValidating,
    mutate: refreshVersions,
  } = useSWR(
    ["modpack-versions", ctx.serverId, pack.project, allowPrerelease],
    async () => {
      const result = await modpackVersionsAction({
        serverId: ctx.serverId,
        allowPrerelease,
      });
      if (result.serverError) throw new Error(result.serverError);
      return result.data ?? null;
    },
  );

  const loader = pack.loader ?? null;
  const target: ModpackTarget | null = loader
    ? {
        provider: pack.provider,
        project: pack.project,
        title: pack.title,
        loader,
        iconUrl: pack.icon_url,
        pageUrl: pack.page_url,
      }
    : null;

  const writable = canMutate(ctx) && ctx.serverStopped;
  const disabledMods = pack.mods.filter((entry) => !entry.enabled).length;

  const unlink = async () => {
    const result = await unlinkModpackAction({ serverId: ctx.serverId });

    if (result.serverError) {
      toast.error(result.serverError);
      return;
    }

    toast.success(t("servers-management:mods.pack.toasts.unlinked"));
    onUnlinked();
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-wrap items-start gap-4">
        <ProjectIcon
          src={pack.icon_url}
          title={pack.title}
          className="size-16"
        />

        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("servers-management:mods.pack.linkedLabel")}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <ProjectTitleLink href={pack.page_url} title={pack.title} />
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{PROVIDER_LABELS[pack.provider]}</Badge>
            {pack.version_number ? (
              <Badge variant="outline">{pack.version_number}</Badge>
            ) : null}
            {loader ? (
              <Badge variant="outline">
                {LOADER_NAMES[loader]}
                {pack.loader_version ? ` ${pack.loader_version}` : ""}
              </Badge>
            ) : null}
            {pack.game_version ? (
              <Badge variant="outline">
                {t("servers-management:mods.pack.minecraftBadge", {
                  version: pack.game_version,
                })}
              </Badge>
            ) : null}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("servers-management:mods.pack.installedOn", {
              date: formatTimestamp(pack.installed_at),
            })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setContentsOpen(true)}
          >
            <ListTree data-icon="inline-start" />
            {t("servers-management:mods.pack.viewContents", {
              count: pack.mods.length,
            })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!writable || !target}
            onClick={() => target && onInstall(target, pack.version)}
          >
            <History data-icon="inline-start" />
            {t("servers-management:mods.switchVersionButton")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("servers-management:mods.pack.moreActions")}
                />
              }
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={isValidating}
                onClick={() => void refreshVersions()}
              >
                <RefreshCw />
                {t("servers-management:mods.pack.checkUpdatesButton")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!writable || !target}
                onClick={() =>
                  target && onInstall({ ...target, reset: true }, pack.version)
                }
              >
                <RotateCcw />
                {t("servers-management:mods.pack.reinstallButton")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={!canMutate(ctx)}
                onClick={() => setUnlinkOpen(true)}
              >
                <Unlink />
                {t("servers-management:mods.pack.unlinkButton")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {versions?.update_available && versions.latest ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-sky-500/40 bg-sky-500/5 p-3">
            <ArrowUpCircle className="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="min-w-0 flex-1 text-sm">
              {t("servers-management:mods.pack.updateAvailable", {
                version: versions.latest.version_number,
              })}
            </span>
            <Button
              size="sm"
              disabled={!writable || !target}
              onClick={() =>
                target && onInstall(target, versions.latest?.id ?? undefined)
              }
            >
              {t("servers-management:mods.pack.reviewUpdate")}
            </Button>
          </div>
        ) : versions ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {t("servers-management:mods.pack.upToDate")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="pack-prerelease"
              checked={allowPrerelease}
              onCheckedChange={setAllowPrerelease}
            />
            <Label
              htmlFor="pack-prerelease"
              className="text-sm font-normal text-muted-foreground"
            >
              {t("servers-management:mods.includeBeta")}
            </Label>
          </div>
          {disabledMods > 0 ? (
            <span className="text-sm text-muted-foreground">
              {t("servers-management:mods.pack.disabledCount", {
                count: disabledMods,
              })}
            </span>
          ) : null}
        </div>

        {pack.missing.length > 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("servers-management:mods.pack.missingFiles", {
              count: pack.missing.length,
            })}
          </p>
        ) : null}

        {loader ? null : (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("servers-management:mods.pack.unlinkedLoader")}
          </p>
        )}

        {ctx.serverStopped ? null : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("servers-management:mods.pack.stopRequired")}
          </p>
        )}
      </CardContent>

      <PackContentsDialog
        ctx={ctx}
        pack={pack}
        open={contentsOpen}
        onOpenChange={setContentsOpen}
        onToggleMod={onToggleMod}
      />

      <AlertDialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("servers-management:mods.pack.unlinkConfirm.title", {
                title: pack.title,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("servers-management:mods.pack.unlinkConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setUnlinkOpen(false);
                void unlink();
              }}
            >
              {t("servers-management:mods.pack.unlinkButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type PackContentsDialogProps = {
  ctx: ModsContext;
  pack: InstalledModpack;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleMod: (entry: ModpackMod) => Promise<void>;
};

function PackContentsDialog({
  ctx,
  pack,
  open,
  onOpenChange,
  onToggleMod,
}: PackContentsDialogProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const mods = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return pack.mods;
    return pack.mods.filter((entry) =>
      `${entry.title ?? ""} ${entry.file_name}`.toLowerCase().includes(needle),
    );
  }, [filter, pack.mods]);

  const toggle = async (entry: ModpackMod) => {
    setBusy(entry.file_name);
    await onToggleMod(entry);
    setBusy(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-5" />
            {t("servers-management:mods.pack.contentsTitle", {
              title: pack.title,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("servers-management:mods.pack.contentsDescription", {
              mods: pack.mods.length,
              files: pack.other_files,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="pl-9"
            placeholder={t("servers-management:mods.content.filterPlaceholder")}
          />
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-1.5 pr-3">
            {mods.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {pack.mods.length === 0
                  ? t("servers-management:mods.pack.noModsOnDisk")
                  : t("servers-management:mods.content.noMatches")}
              </p>
            ) : (
              mods.map((entry) => (
                <div
                  key={`${entry.resource_type}:${entry.file_name}`}
                  className="flex items-center gap-3 rounded-md border p-2 pl-3"
                >
                  <ProjectIcon
                    src={entry.icon_url}
                    title={entry.title ?? entry.file_name}
                    className="size-8"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <ProjectTitleLink
                      href={entry.page_url}
                      title={entry.title ?? entry.file_name}
                      className={cn(
                        "text-sm font-medium",
                        entry.enabled || "text-muted-foreground",
                      )}
                    />
                    {entry.title ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {entry.file_name}
                      </span>
                    ) : null}
                  </span>
                  <Switch
                    checked={entry.enabled}
                    disabled={!canMutate(ctx) || busy !== null}
                    aria-label={
                      entry.enabled
                        ? t("servers-management:mods.actions.disable")
                        : t("servers-management:mods.actions.enable")
                    }
                    onCheckedChange={() => void toggle(entry)}
                  />
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
