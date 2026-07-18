"use client";

import type { ListProjectUsersResponses } from "@/lib/api";
import { InviteMemberDialog } from "./invite-member-dialog";
import { MembersTable } from "./members-table";

export type ProjectMember = ListProjectUsersResponses[200][number];

interface MembersViewProps {
  projectId: string;
  members: ProjectMember[];
}

export function MembersView({ projectId, members }: MembersViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Members</h1>
          <p className="text-sm text-muted-foreground">
            Invite people and assign project roles
          </p>
        </div>
        <InviteMemberDialog projectId={projectId} />
      </div>
      <div className="space-y-8">
        <MembersTable members={members} projectId={projectId} />
      </div>
    </div>
  );
}
