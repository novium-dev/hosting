"use client";

import { deleteApiKeyAction } from "@/actions/api-keys";
import { EditApiKeyDialog } from "@/components/api-keys/edit-api-key-dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ListApiKeysResponses } from "@/lib/api";
import { permissionLabels } from "@/lib/permissions";
import { useAction } from "@/lib/action-hooks";
import { KeyRound, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type ApiKey = ListApiKeysResponses[200][number];

interface ApiKeysTableProps {
  keys: ApiKey[] | undefined;
  isLoading?: boolean;
  error?: boolean;
  /** Show which project each key is scoped to. */
  showScope?: boolean;
  /** Show who each key belongs to. */
  showOwner?: boolean;
  /** Edit and delete through the admin routes, which can reach other users' keys. */
  admin?: boolean;
  /** The viewer's permissions in the project these keys belong to. */
  projectPermissions?: number;
  /** Whether the viewer may edit a given key (only its owner can). */
  canEdit?: (apiKey: ApiKey) => boolean;
  /** Whether the viewer may revoke a given key. */
  canDelete?: (apiKey: ApiKey) => boolean;
  onChanged: () => void;
}

function formatDate(seconds: number | null | undefined, neverLabel: string) {
  if (!seconds) return neverLabel;
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysTable({
  keys,
  isLoading = false,
  error = false,
  showScope = false,
  showOwner = false,
  admin = false,
  projectPermissions,
  canEdit = () => true,
  canDelete = () => true,
  onChanged,
}: ApiKeysTableProps) {
  const { t } = useTranslation();
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const remove = useAction(deleteApiKeyAction, {
    onSuccess: () => {
      setDeleteKey(null);
      onChanged();
      toast.success(t("project:apiKeys.table.revoked"));
    },
    onError: (actionError) => {
      toast.error(
        actionError.error.serverError ?? t("common:state.genericError"),
      );
    },
  });

  const columns = 5 + (showScope ? 1 : 0) + (showOwner ? 1 : 0);

  if (error) {
    return (
      <div className="text-sm text-destructive">
        {t("project:apiKeys.table.loadError")}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t("common:labels.name")}</TableHead>
              {showScope ? (
                <TableHead>
                  {t("project:apiKeys.table.columns.scope")}
                </TableHead>
              ) : null}
              {showOwner ? (
                <TableHead>{t("common:labels.owner")}</TableHead>
              ) : null}
              <TableHead>{t("common:labels.permissions")}</TableHead>
              <TableHead>{t("common:labels.created")}</TableHead>
              <TableHead>
                {t("project:apiKeys.table.columns.lastUsed")}
              </TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={columns}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : !keys || keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} className="h-28">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <KeyRound className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {t("project:apiKeys.table.emptyTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("project:apiKeys.table.emptyDescription")}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              keys.map((apiKey) => {
                const labels = permissionLabels(apiKey.permissions);

                return (
                  <TableRow key={apiKey.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{apiKey.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {apiKey.prefix}…
                      </div>
                    </TableCell>
                    {showScope ? (
                      <TableCell>
                        {apiKey.project ? (
                          <Badge variant="secondary">
                            {apiKey.project_slug ?? apiKey.project}
                          </Badge>
                        ) : (
                          <Badge>
                            {t("project:apiKeys.table.instanceScope")}
                          </Badge>
                        )}
                      </TableCell>
                    ) : null}
                    {showOwner ? (
                      <TableCell className="text-muted-foreground">
                        {apiKey.username}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger render={<Badge variant="secondary" />}>
                          {t("project:shared.permissionCount", {
                            count: labels.length,
                          })}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {labels.length
                            ? labels.join(", ")
                            : t("project:shared.noPermissions")}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(
                        apiKey.created_at,
                        t("project:apiKeys.table.never"),
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(
                        apiKey.last_used,
                        t("project:apiKeys.table.never"),
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit(apiKey) || canDelete(apiKey) ? (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="sm" />}
                          >
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit(apiKey) ? (
                              <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => {
                                  setEditKey(apiKey);
                                  setEditOpen(true);
                                }}
                              >
                                {t("project:apiKeys.table.editAction")}
                              </DropdownMenuItem>
                            ) : null}
                            {canDelete(apiKey) ? (
                              <DropdownMenuItem
                                className="cursor-pointer text-destructive"
                                onClick={() => setDeleteKey(apiKey)}
                              >
                                {t("project:apiKeys.table.revokeAction")}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <EditApiKeyDialog
        apiKey={editKey}
        projectPermissions={projectPermissions}
        admin={admin}
        open={editOpen}
        setOpen={setEditOpen}
        onUpdated={onChanged}
      />

      <AlertDialog
        open={deleteKey !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("project:apiKeys.table.revokeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("project:apiKeys.table.revokeDescription", {
                name: deleteKey?.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isExecuting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteKey) return;
                remove.execute({ id: deleteKey.id, admin });
              }}
              disabled={remove.isExecuting}
            >
              {t("project:apiKeys.table.revokeAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
