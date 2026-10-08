import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  HIGH_USAGE_SUSTAIN_MS,
  HIGH_USAGE_THRESHOLD,
  type UsagePercents,
} from "@/lib/server-status";

type HighUsage = { cpu: number | null; ram: number | null };

export function isHighUsage(percent: number | null): percent is number {
  return percent !== null && percent >= HIGH_USAGE_THRESHOLD;
}

export function HighUsageAlert({ percents }: { percents: UsagePercents }) {
  const { t } = useTranslation();
  const current: HighUsage = {
    cpu: isHighUsage(percents.cpu) ? percents.cpu : null,
    ram: isHighUsage(percents.ram) ? percents.ram : null,
  };
  const high = current.cpu !== null || current.ram !== null;
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<HighUsage>(current);

  if (high && (current.cpu !== shown.cpu || current.ram !== shown.ram)) {
    setShown(current);
  }

  useEffect(() => {
    if (high === visible) {
      return;
    }

    const timeout = window.setTimeout(
      () => setVisible(high),
      HIGH_USAGE_SUSTAIN_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [high, visible]);

  if (!visible) {
    return null;
  }

  return (
    <Alert
      variant="destructive"
      className="border-destructive/40 bg-destructive/10"
    >
      <AlertTriangle className="size-4" />
      <AlertTitle>
        {shown.cpu !== null && shown.ram !== null
          ? t("servers:managementBar.highUsage.cpuAndRamTitle")
          : shown.cpu !== null
            ? t("servers:managementBar.highUsage.cpuTitle")
            : t("servers:managementBar.highUsage.ramTitle")}
      </AlertTitle>
      <AlertDescription>
        {shown.cpu !== null
          ? t("servers:managementBar.highUsage.cpuAtLimit", {
              percent: shown.cpu.toFixed(1),
            })
          : null}
        {shown.ram !== null
          ? t("servers:managementBar.highUsage.ramAtLimit", {
              percent: shown.ram.toFixed(1),
            })
          : null}
        {t("servers:managementBar.highUsage.resourceWarning")}
      </AlertDescription>
    </Alert>
  );
}
