"use client";

import { Laptop, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { deleteOtherSessions, deleteSession, listSessions } from "@/lib/api";
import type { ListSessionsResponse } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { appConfig } from "@/constants/config";
import { useRouter } from "@/lib/navigation";

type ApiError = {
  error?: {
    msg?: string;
  };
};

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "error" in error) {
    return (error as ApiError).error?.msg ?? fallback;
  }

  return fallback;
}

const browsers = [
  { name: "Edge", match: /edg(?:e|a|ios)?\//i },
  { name: "Opera", match: /opr\/|opera/i },
  { name: "Firefox", match: /firefox\/|fxios\//i },
  { name: "Chrome", match: /chrome\/|crios\//i },
  { name: "Safari", match: /safari\//i },
  { name: "curl", match: /curl\//i },
];

const systems = [
  { name: "iOS", match: /iphone|ipad|ipod/i },
  { name: "Android", match: /android/i },
  { name: "macOS", match: /mac os x|macintosh/i },
  { name: "Windows", match: /windows/i },
  { name: "Linux", match: /linux/i },
];

function describeUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return null;

  const browser = browsers.find((entry) => entry.match.test(userAgent))?.name;
  const system = systems.find((entry) => entry.match.test(userAgent))?.name;

  if (browser && system) return `${browser} — ${system}`;
  return browser ?? system ?? null;
}

async function fetchSessions(fallback: string) {
  const response = await listSessions();
  if (response.error) {
    throw new Error(errorMessage(response.error, fallback));
  }

  return response.data ?? [];
}

export function SessionsSection() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const {
    data: sessions = [],
    error,
    isLoading,
    mutate,
  } = useSWR<ListSessionsResponse>(
    "auth/sessions",
    () => fetchSessions(t("settings:sessions.loadError")),
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const formatTimestamp = (value: number) =>
    new Date(value * 1000).toLocaleString(i18n.language, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const others = sessions.filter((session) => !session.current);

  const handleSignOut = () => {
    void authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push(appConfig.authRoutes.signin),
      },
    });
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    const response = await deleteSession({ path: { session_id: id } }).finally(
      () => {
        setRevokingId(null);
      },
    );

    if (response.error) {
      toast.error(
        errorMessage(response.error, t("settings:sessions.revokeError")),
      );
      return;
    }

    await mutate();
    toast.success(t("settings:sessions.revoked"));
  };

  const handleRevokeOthers = async () => {
    setRevokingOthers(true);
    const response = await deleteOtherSessions().finally(() => {
      setRevokingOthers(false);
    });

    if (response.error) {
      toast.error(
        errorMessage(response.error, t("settings:sessions.revokeOthersError")),
      );
      return;
    }

    await mutate();
    toast.success(t("settings:sessions.revokedOthers"));
  };

  return (
    <div className="min-w-0 space-y-6 overflow-hidden">
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium">
              {t("settings:sessions.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("settings:sessions.description")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={others.length === 0}
            loading={revokingOthers}
            onClick={() => void handleRevokeOthers()}
          >
            <LogOut className="size-4" />
            {t("settings:sessions.revokeOthers")}
          </Button>
        </div>

        <div className="space-y-3">
          {isLoading ? (
            <div className="rounded-lg border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
              {t("settings:sessions.loading")}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {t("settings:sessions.loadError")}
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-lg border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
              {t("settings:sessions.empty")}
            </div>
          ) : (
            sessions.map((session) => {
              const label =
                describeUserAgent(session.user_agent) ??
                t("settings:sessions.unknownDevice");

              return (
                <div
                  key={session.id}
                  className="flex flex-col gap-3 rounded-lg border bg-background/50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 gap-3">
                    <Laptop className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        {session.current && (
                          <Badge variant="secondary">
                            {t("settings:sessions.current")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {session.ip_address ??
                          t("settings:sessions.unknownAddress")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings:sessions.lastUsed", {
                          time: formatTimestamp(session.last_used),
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings:sessions.expires", {
                          time: formatTimestamp(session.expires_at),
                        })}
                      </p>
                    </div>
                  </div>

                  {session.current ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleSignOut}
                    >
                      <LogOut className="size-4" />
                      {t("common:actions.signOut")}
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          loading={revokingId === session.id}
                          onClick={() => void handleRevoke(session.id)}
                          aria-label={t("settings:sessions.revokeAriaLabel", {
                            name: label,
                          })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("settings:sessions.revoke")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      <Separator />

      <p className="text-xs text-muted-foreground">
        {t("settings:sessions.hint")}
      </p>
    </div>
  );
}
