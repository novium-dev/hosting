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

export type ApiKey = ListApiKeysResponses[200][number];

interface ApiKeysTableProps {
  keys: ApiKey[] | undefined;
  isLoading?: boolean;
  error?: boolean;
  /** Show which project each key is scoped to. */
  showScope?: boolean;
  /** Show who each key belongs to. */
  showOwner?: boolean;
  /** Delete through the admin route, which can reach other users' keys. */
  admin?: boolean;
  /** Whether the viewer may edit a given key (only its owner can). */
  canEdit?: (apiKey: ApiKey) => boolean;
  /** Whether the viewer may revoke a given key. */
  canDelete?: (apiKey: ApiKey) => boolean;
  onChanged: () => void;
}

function formatDate(seconds: number | null | undefined) {
  if (!seconds) return "Never";
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
  canEdit = () => true,
  canDelete = () => true,
  onChanged,
}: ApiKeysTableProps) {
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const remove = useAction(deleteApiKeyAction, {
    onSuccess: () => {
      setDeleteKey(null);
      onChanged();
      toast.success("API key revoked");
    },
    onError: (actionError) => {
      toast.error(actionError.error.serverError ?? "Something went wrong");
    },
  });

  const columns = 5 + (showScope ? 1 : 0) + (showOwner ? 1 : 0);

  if (error) {
    return (
      <div className="text-sm text-destructive">Failed to load API keys.</div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Name</TableHead>
              {showScope ? <TableHead>Scope</TableHead> : null}
              {showOwner ? <TableHead>Owner</TableHead> : null}
              <TableHead>Permissions</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
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
                    <p className="text-sm font-medium">No API keys yet</p>
                    <p className="text-xs text-muted-foreground">
                      Create one to talk to the API without a browser session.
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
                          <Badge>Instance</Badge>
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
                        <TooltipTrigger asChild>
                          <Badge variant="secondary">
                            {labels.length} permission
                            {labels.length === 1 ? "" : "s"}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {labels.length ? labels.join(", ") : "No permissions"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(apiKey.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(apiKey.last_used)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit(apiKey) || canDelete(apiKey) ? (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEdit(apiKey) ? (
                              <DropdownMenuItem
                                className="cursor-pointer"
                                onSelect={() => {
                                  setEditKey(apiKey);
                                  setEditOpen(true);
                                }}
                              >
                                Edit key
                              </DropdownMenuItem>
                            ) : null}
                            {canDelete(apiKey) ? (
                              <DropdownMenuItem
                                className="cursor-pointer text-destructive"
                                onSelect={() => setDeleteKey(apiKey)}
                              >
                                Revoke key
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
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteKey?.name} stops working immediately. Anything using it
              will start getting 401s.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isExecuting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!deleteKey) return;
                remove.execute({ id: deleteKey.id, admin });
              }}
              disabled={remove.isExecuting}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
