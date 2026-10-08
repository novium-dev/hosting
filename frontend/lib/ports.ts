import type { TFunction } from "i18next";

import type { NetworkProtocol } from "@/lib/api";

export type SelectablePortRange = {
  start: number;
  end: number;
  protocol: NetworkProtocol;
  exclude?: number[];
};

export function formatPortRange(range: SelectablePortRange, t: TFunction) {
  const base =
    range.start === range.end
      ? `${range.protocol.toUpperCase()} ${range.start}`
      : `${range.protocol.toUpperCase()} ${range.start}-${range.end}`;

  return range.exclude?.length
    ? t("admin-infra:servers.shared.rangeExcluding", {
        base,
        exclude: range.exclude.join(", "),
      })
    : base;
}
