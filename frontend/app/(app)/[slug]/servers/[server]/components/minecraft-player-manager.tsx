"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Crown,
  RotateCcw,
  ShieldMinus,
  ShieldPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  banUser,
  deopUser,
  downloadUser,
  opUser,
  pardonUser,
  serverStats,
} from "@/lib/api";
import {
  readHealthCheckPayload,
  readPlayersFromHealthCheck,
  type ServerPlayer,
} from "@/lib/server-players";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type MinecraftPlayer = ServerPlayer;

type MinecraftHealthCheck = {
  host: string;
  port: number;
  server_info: {
    version: { name: string; protocol: number };
    players: {
      max: number;
      online: number;
      Sample: null | MinecraftPlayer[];
      sample?: null | MinecraftPlayer[];
    };
    description: {
      text: string;
      bold: boolean;
      italic: boolean;
      underlined: boolean;
      strikethrough: boolean;
      obfuscated: boolean;
      color: string;
      extra: null;
    };
    favicon: string;
  };
};

type OpsEntry = {
  uuid?: string;
  id?: string;
  name?: string;
  level?: number;
  bypassesPlayerLimit?: boolean;
};

type BanEntry = {
  uuid?: string;
  name?: string;
  created?: string;
  source?: string;
  expires?: string;
  reason?: string;
};

type MinecraftPlayerManagerProps = {
  serverId: string;
  canManagePlayers: boolean;
};

type PlayerAction = "ban" | "pardon" | "op" | "deop";

function readVersionName(healthCheck: MinecraftHealthCheck | null) {
  const name = healthCheck?.server_info?.version?.name;

  return typeof name === "string" ? name : null;
}

function getOpKeys(entry: OpsEntry) {
  return [entry.uuid, entry.id, entry.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
}

function getPlayerKeys(player: MinecraftPlayer) {
  return [player.id, player.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
}

function getBanKeys(entry: BanEntry) {
  return [entry.uuid, entry.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
}

export function MinecraftPlayerManager({
  serverId,
  canManagePlayers,
}: MinecraftPlayerManagerProps) {
  const { t } = useTranslation();
  const [healthCheck, setHealthCheck] = useState<MinecraftHealthCheck | null>(
    null,
  );
  const [ops, setOps] = useState<OpsEntry[]>([]);
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const players = useMemo(
    () => readPlayersFromHealthCheck("minecraft", healthCheck)?.list ?? [],
    [healthCheck],
  );
  const opKeys = useMemo(
    () => new Set(ops.flatMap((entry) => getOpKeys(entry))),
    [ops],
  );

  const loadJsonFile = async (file: string): Promise<unknown[]> => {
    try {
      const response = await downloadUser({
        path: { server_id: serverId },
        query: { file, limit: 1024 * 1024 },
      });

      if (response.error || !response.data?.url) {
        return [];
      }

      const fileResponse = await fetch(response.data.url);
      if (!fileResponse.ok) {
        return [];
      }

      const data = (await fileResponse.json()) as unknown;
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  const loadOps = async () => {
    setOps((await loadJsonFile("/ops.json")) as OpsEntry[]);
  };

  const loadBans = async () => {
    setBans((await loadJsonFile("/banned-players.json")) as BanEntry[]);
  };

  useEffect(() => {
    void loadOps();
    void loadBans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useEffect(() => {
    let mounted = true;
    let socket: WebSocket | null = null;

    setConnection("connecting");

    const connect = async () => {
      try {
        const statsUrl = await serverStats({ path: { server_id: serverId } });

        if (statsUrl.error) {
          if (mounted) {
            setConnection("disconnected");
          }
          return;
        }

        const socketUrl = statsUrl.data;
        if (!socketUrl || typeof socketUrl !== "string") {
          if (mounted) {
            setConnection("disconnected");
          }
          return;
        }

        socket = new WebSocket(socketUrl);

        socket.onopen = () => {
          if (mounted) {
            setConnection("connected");
          }
        };

        socket.onerror = () => {
          if (mounted) {
            setConnection("disconnected");
          }
        };

        socket.onclose = () => {
          if (mounted) {
            setConnection("disconnected");
          }
        };

        socket.onmessage = (event) => {
          if (!mounted || typeof event.data !== "string") {
            return;
          }

          const payload = readHealthCheckPayload(event.data);
          if (payload && readPlayersFromHealthCheck("minecraft", payload)) {
            setHealthCheck(payload as MinecraftHealthCheck);
          }
        };
      } catch {
        if (mounted) {
          setConnection("disconnected");
        }
      }
    };

    void connect();

    return () => {
      mounted = false;
      socket?.close();
    };
  }, [serverId]);

  const executePlayerAction = async (
    action: PlayerAction,
    player: MinecraftPlayer,
  ) => {
    if (!canManagePlayers) {
      toast.error(
        t("servers-management:minecraftPlayerManager.toasts.noPermission"),
      );
      return;
    }

    const actionKey = `${action}:${player.name}`;
    setPendingAction(actionKey);

    try {
      const options = {
        path: { server_id: serverId },
        query: { user: player.name },
      };
      const response =
        action === "ban"
          ? await banUser(options)
          : action === "pardon"
            ? await pardonUser(options)
            : action === "op"
              ? await opUser(options)
              : await deopUser(options);

      if (response.error) {
        const actionFailedKeys: Record<PlayerAction, string> = {
          ban: "servers-management:minecraftPlayerManager.toasts.banFailed",
          pardon:
            "servers-management:minecraftPlayerManager.toasts.pardonFailed",
          op: "servers-management:minecraftPlayerManager.toasts.opFailed",
          deop: "servers-management:minecraftPlayerManager.toasts.deopFailed",
        };

        toast.error(
          response.error.error?.msg ?? t(actionFailedKeys[action]),
        );
        return;
      }

      toast.success(
        t("servers-management:minecraftPlayerManager.toasts.commandSent", {
          name: player.name,
          action,
        }),
      );

      if (action === "op") {
        setOps((current) => [
          ...current.filter(
            (entry) =>
              !getPlayerKeys(player).some((key) =>
                getOpKeys(entry).includes(key),
              ),
          ),
          { uuid: player.id ?? undefined, name: player.name },
        ]);
      }

      if (action === "deop") {
        setOps((current) =>
          current.filter(
            (entry) =>
              !getPlayerKeys(player).some((key) =>
                getOpKeys(entry).includes(key),
              ),
          ),
        );
      }

      if (action === "ban") {
        setBans((current) => [
          ...current.filter(
            (entry) => !getBanKeys(entry).includes(player.name.toLowerCase()),
          ),
          { uuid: player.id ?? undefined, name: player.name },
        ]);
      }

      if (action === "pardon") {
        setBans((current) =>
          current.filter(
            (entry) => !getBanKeys(entry).includes(player.name.toLowerCase()),
          ),
        );
      }

      if (action === "ban" || action === "pardon") {
        window.setTimeout(() => void loadBans(), 1500);
      }
    } finally {
      setPendingAction(null);
    }
  };

  const online = healthCheck?.server_info?.players?.online ?? players.length;
  const max = healthCheck?.server_info?.players?.max ?? null;
  const versionName = readVersionName(healthCheck);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            {t("servers-management:minecraftPlayerManager.title")}
          </CardTitle>
          <CardDescription>
            {t("servers-management:minecraftPlayerManager.description")}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={connection === "connected" ? "default" : "outline"}>
            {t(
              `servers-management:minecraftPlayerManager.connectionStatus.${connection}`,
            )}
          </Badge>
          <Badge variant="secondary">
            {t(
              "servers-management:minecraftPlayerManager.playersOnlineBadge",
              {
                online,
                maxSuffix: max === null ? "" : ` / ${max}`,
              },
            )}
          </Badge>
          {versionName ? <Badge variant="outline">{versionName}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            {t("servers-management:minecraftPlayerManager.emptyState")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("servers-management:minecraftPlayerManager.table.player")}
                </TableHead>
                <TableHead>
                  {t("servers-management:minecraftPlayerManager.table.uuid")}
                </TableHead>
                <TableHead className="text-right">
                  {t("common:labels.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => {
                const isOp = getPlayerKeys(player).some((key) =>
                  opKeys.has(key),
                );

                return (
                  <TableRow key={`${player.id}:${player.name}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <span>{player.name}</span>
                        {isOp ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Crown className="size-4 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t(
                                "servers-management:minecraftPlayerManager.tooltips.operator",
                              )}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {player.id}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={
                                !canManagePlayers ||
                                pendingAction === `op:${player.name}` ||
                                isOp
                              }
                              onClick={() => executePlayerAction("op", player)}
                            >
                              <ShieldPlus />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t(
                              "servers-management:minecraftPlayerManager.tooltips.makeOperator",
                            )}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={
                                !canManagePlayers ||
                                pendingAction === `deop:${player.name}` ||
                                !isOp
                              }
                              onClick={() => executePlayerAction("deop", player)}
                            >
                              <ShieldMinus />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t(
                              "servers-management:minecraftPlayerManager.tooltips.removeOperator",
                            )}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              disabled={
                                !canManagePlayers ||
                                pendingAction === `ban:${player.name}`
                              }
                              onClick={() => executePlayerAction("ban", player)}
                            >
                              <Ban />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t(
                              "servers-management:minecraftPlayerManager.tooltips.banPlayer",
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="mt-6 space-y-3">
          <div className="space-y-0.5">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Ban className="size-4 text-muted-foreground" />
              {t(
                "servers-management:minecraftPlayerManager.bannedSection.title",
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                "servers-management:minecraftPlayerManager.bannedSection.description",
              )}
            </p>
          </div>

          {bans.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              {t(
                "servers-management:minecraftPlayerManager.bannedSection.emptyState",
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t(
                      "servers-management:minecraftPlayerManager.table.player",
                    )}
                  </TableHead>
                  <TableHead>
                    {t(
                      "servers-management:minecraftPlayerManager.table.reason",
                    )}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("common:labels.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bans.map((entry) => {
                  const name =
                    entry.name ?? entry.uuid ?? t("common:status.unknown");

                  return (
                    <TableRow key={`${entry.uuid ?? ""}:${name}`}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.reason ?? "-"}
                        {entry.expires && entry.expires !== "forever"
                          ? t(
                              "servers-management:minecraftPlayerManager.banExpiresSuffix",
                              { expires: entry.expires },
                            )
                          : ""}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                disabled={
                                  !canManagePlayers ||
                                  !entry.name ||
                                  pendingAction === `pardon:${entry.name}`
                                }
                                onClick={() =>
                                  executePlayerAction("pardon", {
                                    id: entry.uuid ?? "",
                                    name: entry.name ?? "",
                                  })
                                }
                              >
                                <RotateCcw />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t(
                                "servers-management:minecraftPlayerManager.tooltips.pardonPlayer",
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
