export const settingsSections = [
  "profile",
  "sessions",
  "daemon",
  "appearance",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const defaultSettingsSection: SettingsSection = "profile";

export function settingsHash(section: SettingsSection) {
  return `#settings/${section}`;
}

export function parseSettingsHash(hash: string): SettingsSection | null {
  const value = hash.replace(/^#/, "");
  if (value === "settings") return defaultSettingsSection;

  const [prefix, section] = value.split("/");
  if (prefix !== "settings") return null;

  return settingsSections.find((entry) => entry === section) ?? null;
}
