import { useParams } from "react-router-dom";
import useSWR from "swr";
import { auth } from "@/lib/auth";
import AcceptInvitationCard from "./accept-invitation-card";
import InvalidInvitationCard from "./invalid-invitation-card";

export default function AcceptInvitation() {
  const { id } = useParams<{ id: string }>();
  const {
    data: invitation,
    error,
    isLoading,
  } = useSWR(id ? ["invitation", id] : null, () =>
    auth.api.getInvitation({ query: { id } }),
  );

  if (isLoading) return null;
  if (error) return <InvalidInvitationCard />;

  return <AcceptInvitationCard invitation={invitation ?? null} />;
}
