import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import {
  Network,
  Archive,
  FolderTree,
  Settings,
  TerminalSquare,
  Wrench,
  PackageSearch,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { serverInfo } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import { useSearchParams } from "@/lib/navigation";
import { hasResourceSupport } from "@/lib/mod-browser/types";
import {
  hasManagementPermission,
  hasServerPermission,
  ManagementPermission,
  mergePermissions,
  ServerPermission,
} from "@/lib/permissions";
import { ServerConsole } from "../components/server-console";
import { BackupsManager } from "../components/backups-manager";
import { FileEditor } from "../components/file-editor";
import { FilesManager } from "../components/files-manager";
import { NetworkPorts } from "../components/network-ports";
import { ServerSettings } from "../components/server-settings";
import { StartupVariables } from "../components/startup-variables";
import { ModPluginBrowser } from "../components/mod-plugin-browser";
import { MinecraftPlayerManager } from "../components/minecraft-player-manager";

type ServerSection = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  permission: number;
  requiresMinecraftResources?: boolean;
  requiresMinecraftServer?: boolean;
};

const SERVER_SECTIONS: ServerSection[] = [
  {
    key: "console",
    label: "Console",
    icon: TerminalSquare,
    description: "TODO: Build live console stream and command input.",
    permission: ServerPermission.TERMINAL_READ,
  },
  {
    key: "files",
    label: "Files",
    icon: FolderTree,
    description: "TODO: Build file browser, editor, and upload actions.",
    permission: ServerPermission.FILES_READ,
  },
  {
    key: "backups",
    label: "Backups",
    icon: Archive,
    description: "Manage backup creation, download, restore, and deletion.",
    permission: ServerPermission.BACKUP_VIEW,
  },
  {
    key: "mods",
    label: "Mods",
    icon: PackageSearch,
    description: "Browse and install Minecraft mods or plugins.",
    permission: ServerPermission.FILES_READ,
    requiresMinecraftResources: true,
  },
  {
    key: "players",
    label: "Players",
    icon: Users,
    description: "View and manage online Minecraft players.",
    permission: ServerPermission.USER_VIEW,
    requiresMinecraftServer: true,
  },
  {
    key: "network",
    label: "Network",
    icon: Network,
    description: "View network allocations and active server ports.",
    permission: ServerPermission.NETWORK_VIEW,
  },
  /*
  {
    key: "schedules",
    label: "Schedules",
    icon: ScrollText,
    description: "TODO: Build task scheduler and cron-like automation.",
  },
  {
    key: "activity",
    label: "Activity",
    icon: Activity,
    description: "TODO: Build audit and activity timeline.",
  },*/
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    description: "Update name and personal server settings.",
    permission: ServerPermission.BUILD_VIEW,
  },
  {
    key: "startup",
    label: "Startup",
    icon: Wrench,
    description:
      "TODO: Build startup command/editor. Variables are intentionally left out for now.",
    permission: ServerPermission.BUILD_VIEW,
  },
];

function getVisibleSections(permissions: number, features: string[]) {
  const isMinecraftServer = features.some((feature) =>
    feature.startsWith("minecraft_"),
  );

  return SERVER_SECTIONS.filter((entry) => {
    if (!hasServerPermission(permissions, entry.permission)) {
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

function getActiveSection(sections: ServerSection[], section?: string[]) {
  const value = section?.[0] ?? "console";
  const match = sections.find((entry) => entry.key === value);

  return match ?? sections[0] ?? SERVER_SECTIONS[0];
}

export default function ClientServerSectionPage() {
  const params = useParams();
  const slug = params.slug ?? "";
  const server = params.server ?? "";
  const sectionPath = params["*"];
  const section = sectionPath ? sectionPath.split("/") : undefined;
  const editPath = useSearchParams().get("path") ?? undefined;

  const { data: session } = authClient.useSession();
  const { data: infoResponse } = useSWR(
    server ? ["server-info", server] : null,
    () => serverInfo({ path: { server_id: server } }),
  );
  const { data: org } = useOrganization(slug);

  const serverData =
    infoResponse && !infoResponse.error ? infoResponse.data : null;
  const effectivePermissions = mergePermissions(
    session?.user.permissions ?? 0,
    org?.permissions ?? 0,
  );
  const visibleSections = getVisibleSections(
    effectivePermissions,
    serverData?.features ?? [],
  );
  const activeSection = getActiveSection(visibleSections, section);

  const hasSuspensionBypassPermission =
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.SERVER_SUSPEND,
    ) ||
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.LIMITS_BYPASS,
    );
  const hasNodeMaintenanceBypassPermission =
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.NODES_MANAGE,
    ) ||
    hasManagementPermission(
      effectivePermissions,
      ManagementPermission.LIMITS_BYPASS,
    );

  const shouldBlockForSuspension =
    Boolean(serverData?.suspended) && !hasSuspensionBypassPermission;
  const shouldBlockForNodeMaintenance =
    Boolean(serverData?.node.maintenance) &&
    !hasNodeMaintenanceBypassPermission;

  const blockReason = shouldBlockForSuspension
    ? "suspended"
    : shouldBlockForNodeMaintenance
      ? "maintenance"
      : null;
  const canViewSecretVariables = hasServerPermission(
    effectivePermissions,
    ServerPermission.ADMIN_MANAGEMENT,
  );
  const canReadFiles = hasServerPermission(
    effectivePermissions,
    ServerPermission.FILES_READ,
  );
  const canWriteFiles = hasServerPermission(
    effectivePermissions,
    ServerPermission.FILES_WRITE,
  );
  const canManagePlayers = hasServerPermission(
    effectivePermissions,
    ServerPermission.USER_EDIT,
  );
  const isEditRoute = section?.[0] === "edit";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {visibleSections.map((entry) => {
          const isActive = !isEditRoute && entry.key === activeSection.key;
          const href =
            entry.key === "console"
              ? `/${slug}/servers/${server}`
              : `/${slug}/servers/${server}/${entry.key}`;

          return (
            <Button
              key={entry.key}
              asChild
              variant={isActive ? "default" : "outline"}
              size="sm"
            >
              <Link href={href} className="inline-flex items-center gap-2">
                <entry.icon className="size-4" />
                {entry.label}
              </Link>
            </Button>
          );
        })}
      </div>

      <Separator />

      {visibleSections.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>No server permissions</CardTitle>
            <CardDescription>
              You do not have access to any management sections for this server.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : blockReason ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>
              {blockReason === "suspended"
                ? "Server is suspended"
                : "Node is in maintenance"}
            </CardTitle>
            <CardDescription className="text-destructive">
              {blockReason === "suspended"
                ? "This server is suspended and actions are currently blocked."
                : `Node ${serverData?.node.display ?? "Unknown"} is in maintenance mode, so server actions are currently blocked.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/${slug}`}>Back to server list</Link>
            </Button>
          </CardContent>
        </Card>
      ) : isEditRoute ? (
        canReadFiles ? (
          <FileEditor
            serverId={server}
            slug={slug}
            path={editPath ?? null}
            canWriteFiles={canWriteFiles}
          />
        ) : (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>No file permissions</CardTitle>
              <CardDescription>
                You do not have access to view files for this server.
              </CardDescription>
            </CardHeader>
          </Card>
        )
      ) : activeSection.key === "console" ? (
        <ServerConsole serverId={server} />
      ) : activeSection.key === "files" ? (
        <FilesManager
          serverId={server}
          slug={slug}
          canWriteFiles={canWriteFiles}
        />
      ) : activeSection.key === "mods" ? (
        <ModPluginBrowser serverId={server} canWriteFiles={canWriteFiles} />
      ) : activeSection.key === "players" ? (
        <MinecraftPlayerManager
          serverId={server}
          canManagePlayers={canManagePlayers}
        />
      ) : activeSection.key === "backups" ? (
        <BackupsManager serverId={server} />
      ) : activeSection.key === "network" ? (
        <NetworkPorts serverId={server} />
      ) : activeSection.key === "settings" ? (
        <ServerSettings
          serverId={server}
          nodeHostname={serverData?.node.ssh_host ?? "Unknown"}
          username={session?.user.name ?? "-"}
          sshPort={serverData?.node.ssh_port ?? null}
        />
      ) : activeSection.key === "startup" ? (
        <StartupVariables
          canViewSecrets={canViewSecretVariables}
          serverId={server}
        />
      ) : (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <activeSection.icon className="size-5" />
              {activeSection.label}
            </CardTitle>
            <CardDescription>{activeSection.description}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
