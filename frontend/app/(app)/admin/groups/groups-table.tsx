"use client";

import { useMemo, useState } from "react";
import { Layers, PlusIcon, Search, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { SortableTableHead } from "@/components/sortable-table-head";
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
import { useTableSort } from "@/hooks/use-table-sort";
import { createGroup, deleteGroup, type ListGroupsResponses } from "@/lib/api";
import { formatGroupLimits } from "@/lib/groups";

type GroupRow = ListGroupsResponses[200][number];

type GroupColumn = "name" | "nodes" | "servers" | "configs";

const GROUP_NAME_PATTERN = /^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$/;

function serverCount(group: GroupRow) {
  return group.nodes.reduce((sum, entry) => sum + entry.server_count, 0);
}

export function GroupsTable({
  groups,
  nodeNames,
  canManage,
  onChanged,
}: {
  groups: GroupRow[];
  nodeNames: Record<string, string>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return groups;
    }

    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(normalizedQuery) ||
        group.nodes.some((entry) =>
          (nodeNames[entry.node] ?? entry.node)
            .toLowerCase()
            .includes(normalizedQuery),
        ),
    );
  }, [groups, nodeNames, query]);

  const accessors = useMemo(
    () => ({
      name: (group: GroupRow) => group.name,
      nodes: (group: GroupRow) => group.nodes.length,
      servers: serverCount,
      configs: (group: GroupRow) => group.deploy_config_count,
    }),
    [],
  );

  const { rows, sort, toggle } = useTableSort<GroupRow, GroupColumn>(
    filteredGroups,
    accessors,
    { column: "name", direction: "asc" },
  );

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeletePending(true);
    try {
      const response = await deleteGroup({
        path: { group_name: deleting.name },
      });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? t("admin-infra:groups.deleteError"),
        );
        return;
      }

      toast.success(t("admin-infra:groups.deleteSuccess"));
      setDeleting(null);
      onChanged();
    } finally {
      setIsDeletePending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {t("admin-infra:groups.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin-infra:groups.description")}
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            {t("admin-infra:groups.createButton")}
          </Button>
        ) : null}
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("admin-infra:groups.searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-muted">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <SortableTableHead column="name" sort={sort} onSort={toggle}>
                {t("common:labels.name")}
              </SortableTableHead>
              <SortableTableHead column="nodes" sort={sort} onSort={toggle}>
                {t("common:nav.nodes")}
              </SortableTableHead>
              <SortableTableHead column="servers" sort={sort} onSort={toggle}>
                {t("admin-infra:groups.columns.servers")}
              </SortableTableHead>
              <SortableTableHead column="configs" sort={sort} onSort={toggle}>
                {t("admin-infra:groups.columns.deployConfigs")}
              </SortableTableHead>
              <TableHead className="text-right">
                {t("common:resources.manage")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <Layers className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("admin-infra:groups.empty")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("admin-infra:groups.emptyDescription")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((group) => (
                <TableRow key={group.name}>
                  <TableCell className="font-medium">
                    {group.name}
                  </TableCell>
                  <TableCell className="space-y-1">
                    {group.nodes.length === 0 ? (
                      <span className="text-muted-foreground">
                        {t("admin-infra:groups.noNodes")}
                      </span>
                    ) : (
                      group.nodes.map((entry) => (
                        <div key={entry.node}>
                          <Link
                            href={`/admin/nodes/${entry.node}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {nodeNames[entry.node] ?? entry.node}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {formatGroupLimits(entry.limits, t).join(" · ")}
                          </p>
                        </div>
                      ))
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {serverCount(group)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {group.deploy_config_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={!canManage || group.deploy_config_count > 0}
                        onClick={() => setDeleting(group)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateGroupDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={onChanged}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:groups.deleteTitle", {
                name: deleting?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:groups.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = name.trim();
    if (trimmed.length > 200 || !GROUP_NAME_PATTERN.test(trimmed)) {
      toast.error(t("admin-infra:groups.invalidName"));
      return;
    }

    setIsPending(true);
    try {
      const response = await createGroup({ body: { name: trimmed } });

      if (response.error) {
        toast.error(
          response.error.error?.msg ?? t("admin-infra:groups.createError"),
        );
        return;
      }

      toast.success(t("admin-infra:groups.createSuccess"));
      setName("");
      onOpenChange(false);
      onSaved();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("admin-infra:groups.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin-infra:groups.createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="group-name">{t("common:labels.name")}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("admin-infra:groups.namePlaceholder")}
              maxLength={200}
              required
            />
            <p className="text-xs text-muted-foreground">
              {t("admin-infra:groups.nameHint")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" loading={isPending}>
              {t("common:actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
