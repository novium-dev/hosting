import { apiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import useSWR from "swr";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteDeployConfig,
  listDeployConfigs,
  listGroups,
  listTemplates,
} from "@/lib/api";

import { authClient } from "@/lib/auth-client";
import { formatMib } from "@/lib/groups";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { DeployConfigDialog } from "./deploy-config-dialog";
import type { DeployConfig } from "@/types/api";

const DEPLOY_REQUEST_EXAMPLE = `POST /api/admin/deploy/configs/{id}/deploy
Authorization: Bearer nvm_…

{ "project": "<project id>", "name": "<server name>", "node": "<optional node id>" }`;

export default function AdminDeployConfigsPage() {
  const { t } = useTranslation();
  const { data: session, isLoading } = authClient.useSession();
  const canManage = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.SERVER_MANAGE,
      )
    : false;
  const canViewGroups = session
    ? hasManagementPermission(
        session.user.permissions,
        ManagementPermission.NODES_VIEW,
      )
    : false;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeployConfig | null>(null);
  const [deleting, setDeleting] = useState<DeployConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data, error, mutate } = useSWR(
    canManage ? ["admin/deploy-configs", canViewGroups] : null,
    async () => {
      const [configsResponse, groupsResponse, templatesResponse] =
        await Promise.all([
          listDeployConfigs(),
          canViewGroups ? listGroups() : null,
          listTemplates(),
        ]);
      if (configsResponse.error || !configsResponse.data) {
        throw new Error("Failed to load deploy configs");
      }
      return {
        configs: configsResponse.data,
        groups: (groupsResponse?.data ?? []).map(({ id, label }) => ({
          id,
          label,
        })),
        templates: templatesResponse.data ?? [],
      };
    },
  );

  if (isLoading) return null;
  if (!canManage) return <NotFoundView />;

  const handleDelete = async () => {
    if (!deleting) return;

    setIsDeleting(true);
    try {
      const response = await deleteDeployConfig({
        path: { config_id: deleting.id },
      });
      if (response.error) {
        toast.error(
          apiErrorMessage(
            response.error,
            t("admin-infra:deployConfigs.deleteError"),
          ),
        );
        return;
      }
      toast.success(t("admin-infra:deployConfigs.deleteSuccess"));
      setDeleting(null);
      await mutate();
    } finally {
      setIsDeleting(false);
    }
  };

  const configs = data?.configs ?? [];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>{t("admin-infra:deployConfigs.title")}</CardTitle>
            <CardDescription>
              {t("admin-infra:deployConfigs.description")}
            </CardDescription>
          </div>
          <div>
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              disabled={!data}
            >
              <Plus className="size-4" />
              {t("admin-infra:deployConfigs.createButton")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">
              {t("admin-infra:deployConfigs.loadError")}
            </p>
          ) : !data ? null : configs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin-infra:deployConfigs.empty")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common:labels.id")}</TableHead>
                    <TableHead>{t("common:labels.name")}</TableHead>
                    <TableHead>
                      {t("admin-infra:deployConfigs.groupLabel")}
                    </TableHead>
                    <TableHead>{t("common:labels.template")}</TableHead>
                    <TableHead>
                      {t("admin-infra:deployConfigs.resourcesLabel")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("common:labels.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map((config) => (
                    <TableRow key={config.id}>
                      <TableCell className="font-mono text-xs">
                        {config.id}
                      </TableCell>
                      <TableCell className="font-medium">
                        {config.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{config.group.label}</Badge>
                      </TableCell>
                      <TableCell>{config.template}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <p>
                          {t("common:resources.cpu")}:{" "}
                          {t("admin-infra:nodes.groupsManager.cores", {
                            value: config.cpu,
                          })}
                          {" · "}
                          {t("common:resources.memory")}:{" "}
                          {formatMib(config.ram)}
                          {" · "}
                          {t("admin-infra:nodes.detailPage.swapLabel")}:{" "}
                          {formatMib(config.swap)}
                        </p>
                        <p>
                          {t("common:resources.disk")}:{" "}
                          {config.disk != null
                            ? formatMib(config.disk)
                            : t("admin-infra:nodes.groupsManager.unlimited")}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditing(config);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                            {t("common:actions.edit")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleting(config)}
                          >
                            <Trash2 className="size-4" />
                            {t("common:actions.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin-infra:deployConfigs.apiTitle")}</CardTitle>
          <CardDescription>
            {t("admin-infra:deployConfigs.apiDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {DEPLOY_REQUEST_EXAMPLE}
          </pre>
        </CardContent>
      </Card>

      {data && (
        <DeployConfigDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          config={editing}
          groups={data.groups}
          templates={data.templates}
          onSaved={() => void mutate()}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin-infra:deployConfigs.deleteTitle", {
                name: deleting?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin-infra:deployConfigs.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
            >
              {t("common:actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
