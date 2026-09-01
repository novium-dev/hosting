import type { ComponentType } from "react";
import {
  Archive,
  FolderTree,
  Network,
  PackageSearch,
  Settings,
  TerminalSquare,
  Users,
  Wrench,
} from "lucide-react";

import { ProjectFeature } from "@/lib/api";
import { hasResourceSupport } from "@/lib/mod-browser/types";
import { hasServerPermission, ServerPermission } from "@/lib/permissions";

export type ServerSection = {
  key: string;
  icon: ComponentType<{ className?: string }>;
  permission: number;
  requiresMinecraftResources?: boolean;
  requiresMinecraftServer?: boolean;
  requiresProjectFeature?: ProjectFeature;
};

export const SERVER_SECTIONS: ServerSection[] = [
  {
    key: "console",
    icon: TerminalSquare,
    permission: ServerPermission.TERMINAL_READ,
  },
  {
    key: "files",
    icon: FolderTree,
    permission: ServerPermission.FILES_READ,
  },
  {
    key: "backups",
    icon: Archive,
    permission: ServerPermission.BACKUP_VIEW,
  },
  {
    key: "mods",
    icon: PackageSearch,
    permission: ServerPermission.FILES_READ,
    requiresMinecraftResources: true,
    requiresProjectFeature: ProjectFeature.MOD_INSTALLER,
  },
  {
    key: "players",
    icon: Users,
    permission: ServerPermission.USER_VIEW,
    requiresMinecraftServer: true,
  },
  {
    key: "network",
    icon: Network,
    permission: ServerPermission.NETWORK_VIEW,
  },
  {
    key: "settings",
    icon: Settings,
    permission: ServerPermission.BUILD_VIEW,
  },
  {
    key: "startup",
    icon: Wrench,
    permission: ServerPermission.BUILD_VIEW,
  },
];

export function getVisibleServerSections(
  permissions: number,
  features: string[],
  projectFeatures: ProjectFeature[],
) {
  const isMinecraftServer = features.includes("minecraft_commands");

  return SERVER_SECTIONS.filter((entry) => {
    if (!hasServerPermission(permissions, entry.permission)) {
      return false;
    }

    if (
      entry.requiresProjectFeature &&
      !projectFeatures.includes(entry.requiresProjectFeature)
    ) {
      return false;
    }

    if (entry.requiresMinecraftResources) {
      return hasResourceSupport(features);
    }

    if (entry.requiresMinecraftServer) {
      return isMinecraftServer;
    }

    return true;
  });
}

export function getActiveServerSection(
  sections: ServerSection[],
  section?: string[],
) {
  const value = section?.[0] ?? "console";
  const match = sections.find((entry) => entry.key === value);

  return match ?? sections[0] ?? SERVER_SECTIONS[0];
}

export function serverSectionHref(slug: string, server: string, key: string) {
  const base = `/${slug}/servers/${server}`;

  return key === "console" ? base : `${base}/${key}`;
}
