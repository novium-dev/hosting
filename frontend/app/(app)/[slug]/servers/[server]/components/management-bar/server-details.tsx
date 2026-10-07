import { useEffect, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Globe,
  Server,
  Users,
  Waypoints,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ServerPlayers } from "@/lib/server-players";
import { formatUptime } from "@/lib/server-status";
import { titleCase } from "@/lib/utils";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }

    const tick = () => setNow(Date.now());
    const immediate = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [active]);

  return now;
}

function AddressButton({ address }: { address: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success(t("servers:managementBar.toasts.addressCopied"));
    } catch {
      toast.error(t("servers:managementBar.toasts.addressCopyFailed"));
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={t("servers:managementBar.copyAddressTitle")}
      className="group inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Waypoints className="size-4" />
      {address}
      {copied ? (
        <Check className="size-3.5 text-green-500" />
      ) : (
        <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

function PlayerCount({ players }: { players: ServerPlayers }) {
  const { t } = useTranslation();
  const names = players.list?.map((player) => player.name) ?? [];

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex items-center gap-1.5" />}
      >
        <Users className="size-4" />
        {players.max !== null
          ? `${players.online}/${players.max}`
          : String(players.online)}
      </TooltipTrigger>
      <TooltipContent>
        {names.length > 0 ? (
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {names.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        ) : (
          t("servers:managementBar.playersOnline")
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function ServerDetails({
  address,
  nodeDisplay,
  template,
  running,
  startedAt,
  players,
  suspended,
  suspensionReason,
  nodeMaintenance,
}: {
  address: string | null;
  nodeDisplay: string;
  template: string;
  running: boolean;
  startedAt: number | null;
  players: ServerPlayers | null;
  suspended: boolean;
  suspensionReason?: string | null;
  nodeMaintenance: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow(running && startedAt !== null);

  return (
    <>
      {address !== null ? (
        <AddressButton address={address} />
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Waypoints className="size-4" />
          {t("servers:managementBar.addressUnavailable")}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <Server className="size-4" />
        {nodeDisplay}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Globe className="size-4" />
        {titleCase(template)}
      </span>
      {startedAt !== null && (
        <span
          className="inline-flex items-center gap-1.5"
          title={t("servers:managementBar.uptimeTitle")}
        >
          <Clock className="size-4" />
          {formatUptime(now - startedAt)}
        </span>
      )}
      {players && <PlayerCount players={players} />}
      {suspended &&
        (suspensionReason ? (
          <Tooltip>
            <TooltipTrigger render={<Badge variant="destructive" />}>
              {t("servers:managementBar.suspendedBadge")}
            </TooltipTrigger>
            <TooltipContent>{suspensionReason}</TooltipContent>
          </Tooltip>
        ) : (
          <Badge variant="destructive">
            {t("servers:managementBar.suspendedBadge")}
          </Badge>
        ))}
      {nodeMaintenance && (
        <Badge variant="destructive">
          {t("servers:managementBar.maintenanceBadge")}
        </Badge>
      )}
    </>
  );
}
