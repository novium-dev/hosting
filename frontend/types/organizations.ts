import type { AuthClientInvitation, AuthClientMember } from "@/lib/auth-client";
import type { AppOrganization } from "@/lib/auth";

export type MemberInfer = AuthClientMember;

export type InvitationInfer = AuthClientInvitation;

export type OrganizationRelations = AppOrganization & {
  members: MemberInfer[];
  invitations: InvitationInfer[];
};

export type InvitationWithOrganization = InvitationInfer & {
  organizationName: string;
  organizationSlug: string;
};

export type OrganizationMemberRole = "member" | "admin" | "owner";
