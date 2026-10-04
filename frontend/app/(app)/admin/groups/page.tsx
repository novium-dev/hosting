import { useState } from "react";
import useSWR from "swr";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import Link from "@/components/link";
import { NotFoundView } from "@/components/not-found-view";
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
import { Button } from "@/components/ui/button";
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
  createGroup,
  deleteGroup,
  listGroups,
  listNodes,
  type ListGroupsResponses,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { formatGroupLimits } from "@/lib/groups";

type GroupRow = ListGroupsResponses[200][number];

const GROUP_NAME_PATTERN = /^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$/;

export default function AdminGroupsPage() {
  const { t } = useTranslation();
  const { data: session, isLoading } = authClient.useSession();
  const canView = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_VIEW,
      )
    : false;
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_MANAGE,
      )
    : false;

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const { data, error, mutate } = useSWR(
    canView ? "admin/groups" : null,
    async () => {
      const [groupsResponse, nodesResponse] = await Promise.all([
        listGroups(),
        listNodes(),
      ]);
      if (groupsResponse.error || !groupsResponse.data) {
        throw new Error("Failed to load groups");
      }
      const nodeNames = Object.fromEntries(
        (nodesResponse.data ?? []).map((node) => [node.id, node.display]),
      );
      return { groups: groupsResponse.data, nodeNames };
    },
  );

  if (isLoading) return null;
  if (!canView) return <NotFoundView />;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed.length > 200 || !GROUP_NAME_PATTERN.test(trimmed)) {
      toast.error(t("admin-infra:groups.invalidName"));
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await createGroup({ body: { name: trimmed } });
      if (response.error) {
        toast.error(
          response.error.error?.msg ?? t("admin-infra:groups.createError"),
        );
        return;
      }
      toast.success(t("admin-infra:groups.createSuccess"));
      setCreateOpen(false);
      setName("");
      await mutate();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;

    setIsActionLoading(true);
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
      await mutate();
    } finally {
      setIsActionLoading(false);
    }
  };

  const groups = data?.groups ?? [];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>{t("admin-infra:groups.title")}</CardTitle>
            <CardDescription>
              {t("admin-infra:groups.description")}
            </CardDescription>
          </div>
          <div>
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              disabled={!canManage || isActionLoading}
            >
              <Plus className="size-4" />
              {t("admin-infra:groups.createButton")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">
              {t("admin-infra:groups.loadError")}
            </p>
          ) : !data ? null : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:groups.empty")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.name")}</TableHead>
                    <TableHead>{t("common:nav.nodes")}</TableHead>
                    <TableHead>
                      {t("admin-infra:groups.columns.servers")}
                    </TableHead>
                    <TableHead>
                      {t("admin-infra:groups.columns.deployConfigs")}
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
                        <TableCell className="align-top">
                          <span
                            className="font-mono text-sm"
                            style={{ paddingLeft: `${depth}rem` }}
                          >
                            {group.name}
                          </span>
                        </TableCell>
                        <TableCell className="space-y-2 align-top">
                          {group.nodes.length === 0 ? (
                            <span className="text-sm text-muted-foreground">
                              {t("admin-infra:groups.noNodes")}
                            </span>
                          ) : (
                            group.nodes.map((entry) => (
                              <div key={entry.node} className="text-xs">
                                <Link
                                  href={`/admin/nodes/${entry.node}`}
                                  className="font-medium underline-offset-4 hover:underline"
                                >
                                  {data.nodeNames[entry.node] ?? entry.node}
                                </Link>
                                <p className="text-muted-foreground">
                                  {formatGroupLimits(entry.limits, t).join(
                                    " · ",
                                  )}
                                </p>
                              </div>
                            ))
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {group.nodes.reduce(
                            (sum, entry) => sum + entry.server_count,
                            0,
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {group.deploy_config_count}
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleting(group)}
                            disabled={!canManage || isActionLoading}
                          >
                            <Trash2 className="size-4" />
                            {t("common:actions.delete")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin-infra:groups.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin-infra:groups.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="group-name">{t("common:labels.name")}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("admin-infra:groups.namePlaceholder")}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin-infra:groups.nameHint")}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isActionLoading}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleCreate();
              }}
              loading={isActionLoading}
              disabled={!canManage}
            >
              {t("common:actions.create")}
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
              {t("admin-infra:groups.deleteTitle", {
                name: deleting?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:groups.deleteDescription")}
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
    </div>
  );
}
