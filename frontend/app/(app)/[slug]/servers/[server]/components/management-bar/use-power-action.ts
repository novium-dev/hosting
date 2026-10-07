import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  killServer,
  restartServer,
  startServer,
  stopServer,
  type PowerAction,
} from "@/lib/api";

const REQUESTS = {
  start: startServer,
  stop: stopServer,
  restart: restartServer,
  kill: killServer,
} satisfies Record<PowerAction, unknown>;

export function usePowerAction(serverId: string) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PowerAction | null>(null);

  const execute = async (action: PowerAction) => {
    setPending(action);

    try {
      const { error } = await REQUESTS[action]({
        path: { server_id: serverId },
      });

      if (error) {
        toast.error(
          t(`servers:managementBar.errors.${action}Failed`, {
            msg: error.error?.msg,
          }),
        );
        return;
      }

      toast.success(
        t("servers:managementBar.commandSent", {
          action: t(`servers:managementBar.actions.${action}`),
        }),
      );
    } catch {
      toast.error(t("common:state.genericError"));
    } finally {
      setPending(null);
    }
  };

  return { pending, execute };
}
