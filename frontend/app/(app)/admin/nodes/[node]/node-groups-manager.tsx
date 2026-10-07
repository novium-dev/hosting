"use client";

import { useState } from "react";
import {
  CornerDownRight,
  Layers,
  Loader2,
  PencilIcon,
  Plus,
  RefreshCcw,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "@/components/link";
import {
  assignGroupNode,
  removeGroupNode,
  type ListNodeGroupsResponses,
  type ResourceSubset,
} from "@/lib/api";
import { useGroups, useNodeGroups } from "@/hooks/use-shared-queries";
import { formatMib, groupDepths } from "@/lib/groups";
import { Progress } from "@/components/ui/progress";
import type { GroupLimits } from "@/lib/api";

type NodeGroupRow = ListNodeGroupsResponses[200][number];

type NodeGroupsManagerProps = {
  nodeId: string;
  groupUsage: Record<string, ResourceSubset> | null;
  canManage: boolean;
};

type GroupForm = {
  group: string;
  cpu: string;
  ram: string;
  swap: string;
};

const EMPTY_FORM: GroupForm = { group: "", cpu: "", ram: "", swap: "" };

function parseLimits(form: GroupForm): GroupLimits | null {
  const parse = (value: string, integer: boolean, allowZero: boolean) => {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const number = Number(trimmed);
    if (!Number.isFinite(number)) return undefined;
    if (integer && !Number.isInteger(number)) return undefined;
    if (allowZero ? number < 0 : number <= 0) return undefined;
    return number;
  };

  const cpu = parse(form.cpu, false, false);
  const ram = parse(form.ram, true, false);
  const swap = parse(form.swap, true, true);
  if (cpu === undefined || ram === undefined || swap === undefined) {
    return null;
  }
  return { cpu, ram, swap };
}

type Meter = {
  used: number | null;
  limit: number | null | undefined;
  own: number | null | undefined;
  format: (value: number) => string;
};

function ResourceMeter({ used, limit, own, format }: Meter) {
  const { t } = useTranslation();
  const unlimited = t("admin-infra:nodes.groupsManager.unlimited");
  const percent =
    used != null && limit != null && limit > 0
      ? Math.min((used / limit) * 100, 100)
      : null;

  return (
    <div className="min-w-36 space-y-1.5">
      <p className="text-sm tabular-nums">
        {used == null ? "—" : format(used)}
        <span className="text-muted-foreground">
          {" / "}
          {limit != null ? format(limit) : unlimited}
        </span>
      </p>
      {percent != null && (
        <Progress
          value={percent}
          className={
            percent >= 90
              ? "h-1.5 [&>[data-slot=progress-indicator]]:bg-destructive"
              : percent >= 75
                ? "h-1.5 [&>[data-slot=progress-indicator]]:bg-amber-500"
                : "h-1.5"
          }
        />
      )}
      {(own ?? null) !== (limit ?? null) && (
        <p className="text-xs text-muted-foreground">
          {t("admin-infra:nodes.groupsManager.ownLimit", {
            value: own != null ? format(own) : unlimited,
          })}
        </p>
      )}
    </div>
  );
}

export function NodeGroupsManager({
  nodeId,
  groupUsage,
  canManage,
}: NodeGroupsManagerProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NodeGroupRow | null>(null);
  const [deleting, setDeleting] = useState<NodeGroupRow | null>(null);
  const [form, setForm] = useState<GroupForm>(EMPTY_FORM);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const { data: groups, error, isValidating, mutate } = useNodeGroups(nodeId);

  const { data: allGroups } = useGroups(canManage);

  const assigned = new Set((groups ?? []).map((group) => group.id));
  const availableGroups = (allGroups ?? []).filter(
    (group) =>
      !assigned.has(group.id) &&
      (group.parent == null || assigned.has(group.parent)),
  );
  const depths = groupDepths(groups ?? []);
  const hasSubgroupsHere = (group: NodeGroupRow) =>
    (groups ?? []).some((entry) => entry.parent === group.id);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (group: NodeGroupRow) => {
    setEditing(group);
    setForm({
      group: String(group.id),
      cpu: group.limits.cpu != null ? String(group.limits.cpu) : "",
      ram: group.limits.ram != null ? String(group.limits.ram) : "",
      swap: group.limits.swap != null ? String(group.limits.swap) : "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const groupId = editing ? editing.id : Number(form.group);
    if (!groupId) {
      toast.error(t("admin-infra:nodes.groupsManager.selectGroupPlaceholder"));
      return;
    }

    const limits = parseLimits(form);
    if (!limits) {
      toast.error(t("admin-infra:nodes.groupsManager.invalidLimits"));
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await assignGroupNode({
        path: { group_id: groupId, node_id: nodeId },
        body: limits,
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            (editing
              ? t("admin-infra:nodes.groupsManager.updateError")
              : t("admin-infra:nodes.groupsManager.createError")),
        );
        return;
      }

      toast.success(
        editing
          ? t("admin-infra:nodes.groupsManager.updateSuccess")
          : t("admin-infra:nodes.groupsManager.createSuccess"),
      );
      setDialogOpen(false);
      await mutate();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;

    setIsActionLoading(true);
    try {
      const response = await removeGroupNode({
        path: { group_id: deleting.id, node_id: nodeId },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ??
            t("admin-infra:nodes.groupsManager.deleteError"),
        );
        return;
      }

      toast.success(t("admin-infra:nodes.groupsManager.deleteSuccess"));
      setDeleting(null);
      await mutate();
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>{t("admin-infra:nodes.groupsManager.title")}</CardTitle>
          <CardDescription>
            {t("admin-infra:nodes.groupsManager.description")}
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={openCreate}
            disabled={isActionLoading || !canManage}
          >
            <Plus className="size-4" />
            {t("admin-infra:nodes.groupsManager.addButton")}
          </Button>
          <Button
            variant="ghost"
            render={<Link href="/admin/groups" />}
            nativeButton={false}
          >
            {t("admin-infra:nodes.groupsManager.manageGroupsLink")}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => {
              void mutate();
            }}
            disabled={isActionLoading || isValidating}
            aria-label={t("common:actions.refresh")}
          >
            {isValidating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">
            {t("admin-infra:nodes.groupsManager.loadError")}
          </p>
        ) : !groups ? null : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:nodes.groupsManager.empty")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-muted">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>{t("common:resources.cpu")}</TableHead>
                  <TableHead>{t("common:resources.memory")}</TableHead>
                  <TableHead>
                    {t("admin-infra:nodes.detailPage.swapLabel")}
                  </TableHead>
                  <TableHead>
                    {t("admin-infra:nodes.groupsManager.columns.servers")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("common:resources.manage")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const usage = groupUsage?.[group.daemon_name];
                  const depth = depths.get(group.id) ?? 0;
                  const cores = (value: number) =>
                    t("admin-infra:nodes.groupsManager.cores", {
                      value: Number(value.toFixed(2)),
                    });
                  return (
                    <TableRow key={group.id}>
                      <TableCell>
                        <div
                          className="flex items-center gap-2"
                          style={{
                            paddingLeft: `${Math.max(depth - 1, 0) * 1.5}rem`,
                          }}
                        >
                          {depth > 0 ? (
                            <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <Layers className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-medium">{group.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ResourceMeter
                          used={usage?.cpu_used ?? null}
                          limit={
                            usage ? usage.cpu_limit_effective : group.limits.cpu
                          }
                          own={group.limits.cpu}
                          format={cores}
                        />
                      </TableCell>
                      <TableCell>
                        <ResourceMeter
                          used={usage?.mem_used ?? null}
                          limit={
                            usage ? usage.mem_limit_effective : group.limits.ram
                          }
                          own={group.limits.ram}
                          format={formatMib}
                        />
                      </TableCell>
                      <TableCell>
                        <ResourceMeter
                          used={usage?.swap_used ?? null}
                          limit={
                            usage
                              ? usage.swap_limit_effective
                              : group.limits.swap
                          }
                          own={group.limits.swap}
                          format={formatMib}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {group.server_count}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(group)}
                            disabled={isActionLoading || !canManage}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleting(group)}
                            disabled={
                              isActionLoading ||
                              !canManage ||
                              hasSubgroupsHere(group)
                            }
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("admin-infra:nodes.groupsManager.editTitle", {
                    name: editing.label,
                  })
                : t("admin-infra:nodes.groupsManager.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("admin-infra:nodes.groupsManager.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {!editing && (
              <div className="grid gap-2">
                <Label htmlFor="node-group-name">
                  {t("admin-infra:nodes.groupsManager.groupLabel")}
                </Label>
                {availableGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("admin-infra:nodes.groupsManager.noGroupsAvailable")}
                  </p>
                ) : (
                  <Select
                    items={[
                      ...availableGroups.map((group) => ({
                        value: String(group.id),
                        label: group.label,
                      })),
                    ]}
                    value={form.group}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, group: value ?? "" }))
                    }
                  >
                    <SelectTrigger id="node-group-name" className="w-full">
                      <SelectValue
                        placeholder={t(
                          "admin-infra:nodes.groupsManager.selectGroupPlaceholder",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableGroups.map((group) => (
                        <SelectItem key={group.id} value={String(group.id)}>
                          {group.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="node-group-cpu">
                  {t("admin-infra:nodes.groupsManager.cpuLabel")}
                </Label>
                <Input
                  id="node-group-cpu"
                  value={form.cpu}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, cpu: event.target.value }))
                  }
                  placeholder={t("admin-infra:nodes.groupsManager.unlimited")}
                  inputMode="decimal"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="node-group-ram">
                  {t("admin-infra:nodes.groupsManager.ramLabel")}
                </Label>
                <Input
                  id="node-group-ram"
                  value={form.ram}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, ram: event.target.value }))
                  }
                  placeholder={t("admin-infra:nodes.groupsManager.unlimited")}
                  inputMode="numeric"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="node-group-swap">
                  {t("admin-infra:nodes.groupsManager.swapLabel")}
                </Label>
                <Input
                  id="node-group-swap"
                  value={form.swap}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, swap: event.target.value }))
                  }
                  placeholder={t("admin-infra:nodes.groupsManager.unlimited")}
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              loading={isActionLoading}
              disabled={!canManage}
            >
              {editing ? t("common:actions.save") : t("common:actions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:nodes.groupsManager.deleteTitle", {
                name: deleting?.label ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:nodes.groupsManager.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isActionLoading || !canManage}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
