import type { TFunction } from "i18next";

export function formatMib(value: number) {
  return value >= 1024 ? `${(value / 1024).toFixed(2)} GiB` : `${value} MiB`;
}

export function formatGroupLimits(
  limits: { cpu?: number | null; ram?: number | null; swap?: number | null },
  t: TFunction,
) {
  const unlimited = t("admin-infra:nodes.groupsManager.unlimited");
  return [
    `${t("common:resources.cpu")}: ${
      limits.cpu != null
        ? t("admin-infra:nodes.groupsManager.cores", { value: limits.cpu })
        : unlimited
    }`,
    `${t("common:resources.memory")}: ${
      limits.ram != null ? formatMib(limits.ram) : unlimited
    }`,
    `${t("admin-infra:nodes.detailPage.swapLabel")}: ${
      limits.swap != null ? formatMib(limits.swap) : unlimited
    }`,
  ];
}

type TreeItem = { id: number; parent?: number | null };

export function groupDepths(groups: TreeItem[]) {
  const parents = new Map(
    groups.map((group) => [group.id, group.parent ?? null]),
  );
  const depths = new Map<number, number>();
  for (const group of groups) {
    let depth = 0;
    let parent = parents.get(group.id) ?? null;
    while (parent !== null && depth < 16) {
      depth += 1;
      parent = parents.get(parent) ?? null;
    }
    depths.set(group.id, depth);
  }
  return depths;
}
