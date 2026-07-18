"use client";

import {
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { parseUserAgent } from "@/lib/utils";
import { Laptop } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "nextjs-toploader/app";
import { useState } from "react";

type Session = {
  id: string;
  token: string;
  userAgent?: string | null;
};

interface SessionsCardProps {
  sessions: Session[];
  currentSessionId: string;
}

export default function SessionsCard({
  sessions,
  currentSessionId,
}: SessionsCardProps) {
  const router = useRouter();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const revokeSession = useAction(revokeSessionAction);
  const revokeOtherSessions = useAction(revokeOtherSessionsAction);

  return (
    <Card className="bg-card text-card-foreground rounded-2xl border shadow-sm">
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          Manage your active sessions and revoke access.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sessions.map((session) => {
          const isCurrent = session.id === currentSessionId;
          const { browser, device } = parseUserAgent(
            session.userAgent ?? undefined
          );

          return (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-xl border px-6 py-4 bg-background/50"
            >
              <div className="flex items-center gap-3">
                <Laptop className="w-5 h-5 text-muted-foreground" />
                <span className="font-medium text-sm">
                  {isCurrent ? "Current Session" : `${browser}, ${device}`}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedSessionId(session.id);
                  if (isCurrent) {
                    authClient.signOut({
                      fetchOptions: {
                        onSuccess: () => {
                          router.push(appConfig.authRoutes.signin);
                        },
                      },
                    });
                  } else {
                    revokeSession.executeAsync({ token: session.token });
                  }
                }}
                loading={
                  revokeSession.isExecuting && selectedSessionId === session.id
                }
                disabled={
                  revokeSession.isExecuting && selectedSessionId === session.id
                }
              >
                {isCurrent ? "Sign Out" : "Revoke"}
              </Button>
            </div>
          );
        })}
      </CardContent>
      <Separator />
      <CardFooter className="flex flex-row justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          This action will revoke all sessions except the current one.
        </p>
        <Button
          type="button"
          size="sm"
          loading={revokeOtherSessions.isExecuting}
          disabled={revokeOtherSessions.isExecuting || sessions.length <= 1}
          onClick={() => revokeOtherSessions.executeAsync({})}
        >
          Revoke Other Sessions
        </Button>
      </CardFooter>
    </Card>
  );
}
