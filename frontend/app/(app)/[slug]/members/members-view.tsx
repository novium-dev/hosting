"use client";

import { useTranslation } from "react-i18next";
import type { ListProjectUsersResponses } from "@/lib/api";
import { InviteMemberDialog } from "./invite-member-dialog";
import { MembersTable } from "./members-table";

export type ProjectMember = ListProjectUsersResponses[200][number];

interface MembersViewProps {
  projectId: string;
  ownerId: number;
  members: ProjectMember[];
}

export function MembersView({ projectId, ownerId, members }: MembersViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("common:nav.members")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("project:members.description")}
          </p>
        </div>
        <InviteMemberDialog projectId={projectId} />
      </div>
      <div className="space-y-8">
        <MembersTable
          members={members}
          projectId={projectId}
          ownerId={ownerId}
        />
      </div>
    </div>
  );
}
