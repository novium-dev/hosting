"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

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
  listGroups,
  listNodeGroups,
  removeGroupNode,
  type ListNodeGroupsResponses,
  type ResourceSubset,
} from "@/lib/api";
import { formatGroupLimits, formatMib } from "@/lib/groups";

type NodeGroupRow = ListNodeGroupsResponses[200][number];

type NodeGroupsManagerProps = {
  nodeId: string;
  groupUsage: Record<string, ResourceSubset> | null;
  canManage: boolean;
};

type GroupForm = {
  name: string;
  cpu: string;
  ram: string;
  swap: string;
};

type GroupLimits = {
  cpu: number | null;
  ram: number | null;
  swap: number | null;
};

const EMPTY_FORM: GroupForm = { name: "", cpu: "", ram: "", swap: "" };

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

function formatUsage(usage: ResourceSubset | undefined, t: TFunction) {
  if (!usage) return [t("admin-infra:nodes.detailPage.unavailable")];
  const cpuLimit = usage.cpu_limit_effective;
  const memLimit = usage.mem_limit_effective;
  return [
    `${t("common:resources.cpu")}: ${usage.cpu_used.toFixed(2)}${
      cpuLimit != null
        ? ` / ${t("admin-infra:nodes.groupsManager.cores", { value: cpuLimit })}`
        : ""
    }`,
    `${t("common:resources.memory")}: ${formatMib(usage.mem_used)}${
      memLimit != null ? ` / ${formatMib(memLimit)}` : ""
    }`,
  ];
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

  const {
    data: groups,
    error,
    isValidating,
    mutate,
  } = useSWR(["admin-node-groups", nodeId], async () => {
    const response = await listNodeGroups({ path: { node_id: nodeId } });
    if (response.error || !response.data) {
      throw new Error("Failed to load node groups");
    }
    return response.data;
  });

  const { data: allGroups } = useSWR(
    canManage ? ["admin-groups"] : null,
    async () => {
      const response = await listGroups();
      return response.error || !response.data
        ? []
        : response.data.map((group) => group.name);
    },
  );

  const availableGroups = (allGroups ?? []).filter(
    (name) => !(groups ?? []).some((group) => group.name === name),
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (group: NodeGroupRow) => {
    setEditing(group);
    setForm({
      name: group.name,
      cpu: group.limits.cpu != null ? String(group.limits.cpu) : "",
      ram: group.limits.ram != null ? String(group.limits.ram) : "",
      swap: group.limits.swap != null ? String(group.limits.swap) : "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const name = editing ? editing.name : form.name;
    if (!name) {
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
        path: { group_name: name, node_id: nodeId },
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
        path: { group_name: deleting.name, node_id: nodeId },
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
          <Button asChild variant="ghost">
            <Link href="/admin/groups">
              {t("admin-infra:nodes.groupsManager.manageGroupsLink")}
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void mutate();
            }}
            disabled={isActionLoading || isValidating}
          >
            {isValidating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            {t("common:actions.refresh")}
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
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common:labels.name")}</TableHead>
                  <TableHead>
                    {t("admin-infra:nodes.groupsManager.columns.limits")}
                  </TableHead>
                  <TableHead>
                    {t("admin-infra:nodes.groupsManager.columns.usage")}
                  </TableHead>
                  <TableHead>
                    {t("admin-infra:nodes.groupsManager.columns.servers")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("common:labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const depth = group.name.split("-").length - 1;
                  return (
                    <TableRow key={group.name}>
                      <TableCell>
                        <span
                          className="font-mono text-sm"
                          style={{ paddingLeft: `${depth}rem` }}
                        >
                          {group.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatGroupLimits(group.limits, t).map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatUsage(groupUsage?.[group.name], t).map(
                          (line) => (
                            <p key={line}>{line}</p>
                          ),
                        )}
                      </TableCell>
                      <TableCell>{group.server_count}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(group)}
                            disabled={isActionLoading || !canManage}
                          >
                            <Pencil className="size-4" />
                            {t("common:actions.edit")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleting(group)}
                            disabled={isActionLoading || !canManage}
                          >
                            <Trash2 className="size-4" />
                            {t("common:actions.delete")}
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
                    name: editing.name,
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
                    value={form.name}
                    onValueChange={(value) =>
                      setForm((prev) => ({ ...prev, name: value }))
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
                      {availableGroups.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
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
                name: deleting?.name ?? "",
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
