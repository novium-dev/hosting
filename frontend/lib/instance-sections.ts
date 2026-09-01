import type { ComponentType } from "react";
import { Table2, UserRound } from "lucide-react";

export type InstanceSection = {
  key: "databases" | "users";
  icon: ComponentType<{ className?: string }>;
  titleKey: string;
};

export const INSTANCE_SECTIONS: InstanceSection[] = [
  { key: "databases", icon: Table2, titleKey: "common:nav.databases" },
  { key: "users", icon: UserRound, titleKey: "common:nav.users" },
];

export function instanceSectionHref(
  slug: string,
  instance: string,
  key: string,
) {
  const base = `/${slug}/databases/${instance}`;

  return key === "databases" ? base : `${base}/${key}`;
}

export function getActiveInstanceSection(section: string) {
  return INSTANCE_SECTIONS.some((entry) => entry.key === section)
    ? (section as InstanceSection["key"])
    : "databases";
}
