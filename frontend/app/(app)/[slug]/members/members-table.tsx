"use client";

import { removeProjectUserAction } from "@/actions/project-users";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TextEllipsis } from "@/components/ui/text-ellipsis";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { serverPermissionLabels } from "@/lib/permissions";
import { MoreHorizontal, Users } from "lucide-react";
import { useAction } from "@/lib/action-hooks";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ProjectMember } from "./members-view";
import { UpdateMemberRoleDialog } from "./update-member-role";

interface MembersTableProps {
  members: ProjectMember[];
  projectId: string;
}

export function MembersTable({ members, projectId }: MembersTableProps) {
  const { t } = useTranslation();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<ProjectMember | null>(null);
  const [member, setMember] = useState<ProjectMember | null>(null);

  const remove = useAction(removeProjectUserAction, {
    onSuccess: () => {
      toast.success(t("org:members.table.removeSuccess"));
      setRemoveMember(null);
    },
    onError: (error) => {
      toast.error(error.error.serverError ?? t("common:state.genericError"));
    },
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">
              {t("org:members.table.userColumn")}
            </TableHead>
            <TableHead>{t("common:labels.email")}</TableHead>
            <TableHead>{t("common:labels.permissions")}</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-28">
                <div className="flex flex-col items-center justify-center gap-2 text-center">
                  <Users className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {t("org:members.table.emptyTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("org:members.table.emptyDescription")}
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            members.map((member) => {
              const permissionLabels = serverPermissionLabels(
                member.permissions,
              );

              return (
                <TableRow key={member.id}>
                  <TableCell className="flex items-center gap-2">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg">
                        {(member.username || member.email)
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <TextEllipsis className="text-sm" width={160}>
                      {member.username || member.email}
                    </TextEllipsis>
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary">
                          {t("org:shared.permissionCount", {
                            count: permissionLabels.length,
                          })}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {permissionLabels.length
                          ? permissionLabels.join(", ")
                          : t("org:shared.noPermissions")}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onSelect={() => {
                            setMember(member);
                            setUpdateOpen(true);
                          }}
                        >
                          {t("org:members.table.updateAction")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer text-destructive"
                          onSelect={() => setRemoveMember(member)}
                        >
                          {t("org:members.table.removeAction")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <UpdateMemberRoleDialog
        member={member}
        projectId={projectId}
        open={updateOpen}
        setOpen={setUpdateOpen}
      />

      <AlertDialog
        open={removeMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveMember(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("org:members.table.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("org:members.table.removeDescription", {
                email: removeMember?.email,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isExecuting}>
              {t("common:actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!removeMember) return;
                remove.execute({ projectId, userId: removeMember.id });
              }}
              disabled={remove.isExecuting}
            >
              {t("org:members.table.removeAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
