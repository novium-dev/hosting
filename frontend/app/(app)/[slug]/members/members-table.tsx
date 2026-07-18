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
import { projectRoleFromPermissions } from "@/lib/permissions";
import { MoreHorizontal, Users } from "lucide-react";
import { useAction } from "@/lib/action-hooks";
import { useState } from "react";
import { toast } from "sonner";
import type { ProjectMember } from "./members-view";
import { UpdateMemberRoleDialog } from "./update-member-role";

interface MembersTableProps {
  members: ProjectMember[];
  projectId: string;
}

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function MembersTable({ members, projectId }: MembersTableProps) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<ProjectMember | null>(null);
  const [member, setMember] = useState<ProjectMember | null>(null);

  const remove = useAction(removeProjectUserAction, {
    onSuccess: () => {
      toast.success("Member removed successfully");
      setRemoveMember(null);
    },
    onError: (error) => {
      toast.error(error.error.serverError ?? "Something went wrong");
    },
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">User</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-28">
                <div className="flex flex-col items-center justify-center gap-2 text-center">
                  <Users className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">No members yet</p>
                  <p className="text-xs text-muted-foreground">
                    Invite someone to give them access to this project.
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            members.map((member) => {
              const role = projectRoleFromPermissions(member.permissions);

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
                    <Badge>{roleLabels[role]}</Badge>
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
                          Update Member
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer text-destructive"
                          onSelect={() => setRemoveMember(member)}
                        >
                          Remove Member
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
            <AlertDialogTitle>Remove Member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {removeMember?.email} from the project. They will
              lose access to all of its servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isExecuting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!removeMember) return;
                remove.execute({ projectId, userId: removeMember.id });
              }}
              disabled={remove.isExecuting}
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
