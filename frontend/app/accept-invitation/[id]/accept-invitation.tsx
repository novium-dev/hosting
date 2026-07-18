"use client";

import { useEffect } from "react";

export default function AcceptInvitation({
  children,
  invitationId,
}: {
  children: React.ReactNode;
  invitationId: string;
}) {
  useEffect(() => {
    localStorage.setItem("invitation-id", invitationId);
  }, [invitationId]);

  return children;
}
