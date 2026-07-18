import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import AcceptInvitationCard from "./accept-invitation-card";
import InvalidInvitationCard from "./invalid-invitation-card";

export default async function AcceptInvitation({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const invitation = await auth.api.getInvitation({
      query: { id },
      headers: await headers(),
    });
    return <AcceptInvitationCard invitation={invitation} />;
  } catch {
    return <InvalidInvitationCard />;
  }
}
