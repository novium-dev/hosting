import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
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
import { ProjectFeature, serverInfo } from "@/lib/api";
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
import { RoutesManager } from "../components/routes-manager";
import { ServerSettings } from "../components/server-settings";
import { StartupVariables } from "../components/startup-variables";
import { ModPluginBrowser } from "../components/mod-plugin-browser";
import { MinecraftPlayerManager } from "../components/minecraft-player-manager";

type ServerSection = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: number;
  requiresMinecraftResources?: boolean;
  requiresMinecraftServer?: boolean;
  requiresProjectFeature?: ProjectFeature;
};

const SERVER_SECTIONS: ServerSection[] = [
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

function getVisibleSections(
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

function getActiveSection(sections: ServerSection[], section?: string[]) {
  const value = section?.[0] ?? "console";
  const match = sections.find((entry) => entry.key === value);

  return match ?? sections[0] ?? SERVER_SECTIONS[0];
}

export default function ClientServerSectionPage() {
  const { t } = useTranslation();
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
    org?.features ?? [],
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
  const canCreateBackup = hasServerPermission(
    effectivePermissions,
    ServerPermission.BACKUP_CREATE,
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
                {t(`servers:page.sections.${entry.key}.label`)}
              </Link>
            </Button>
          );
        })}
      </div>

      <Separator />

      {visibleSections.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("servers:page.noPermissions.title")}</CardTitle>
            <CardDescription>
              {t("servers:page.noPermissions.description")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : blockReason ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>
              {blockReason === "suspended"
                ? t("servers:page.blocked.suspendedTitle")
                : t("servers:page.blocked.maintenanceTitle")}
            </CardTitle>
            <CardDescription className="text-destructive">
              {blockReason === "suspended"
                ? (serverData?.suspension_reason ??
                  t("servers:page.blocked.suspendedDefaultReason"))
                : t("servers:page.blocked.maintenanceReason", {
                    node:
                      serverData?.node.display ?? t("common:status.unknown"),
                  })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/${slug}`}>{t("servers:shared.backToServerList")}</Link>
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
              <CardTitle>{t("servers:page.noFilePermissions.title")}</CardTitle>
              <CardDescription>
                {t("servers:page.noFilePermissions.description")}
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
        <div className="space-y-4">
          <NetworkPorts serverId={server} />
          {hasServerPermission(
            effectivePermissions,
            ServerPermission.ROUTES_VIEW,
          ) ? (
            <RoutesManager
              serverId={server}
              canManage={hasServerPermission(
                effectivePermissions,
                ServerPermission.ROUTES_MANAGE,
              )}
            />
          ) : null}
        </div>
      ) : activeSection.key === "settings" ? (
        <ServerSettings
          serverId={server}
          nodeHostname={serverData?.node.ssh_host ?? t("common:status.unknown")}
          username={session?.user.name ?? "-"}
          sshPort={serverData?.node.ssh_port ?? null}
          canWriteFiles={canWriteFiles}
          canCreateBackup={canCreateBackup}
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
              {t(`servers:page.sections.${activeSection.key}.label`)}
            </CardTitle>
            <CardDescription>
              {t(`servers:page.sections.${activeSection.key}.description`)}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
