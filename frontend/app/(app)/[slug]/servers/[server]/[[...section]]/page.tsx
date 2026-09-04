import Link from "@/components/link";
import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { serverInfo } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useModpackJob } from "@/hooks/use-modpack-job";
import { useProject } from "@/hooks/use-project";
import { hasResourceSupport } from "@/lib/mod-browser/types";
import { useSearchParams } from "@/lib/navigation";
import {
  hasManagementPermission,
  hasServerPermission,
  ManagementPermission,
  mergePermissions,
  ServerPermission,
} from "@/lib/permissions";
import {
  getActiveServerSection,
  getVisibleServerSections,
} from "@/lib/server-sections";
import { ServerConsole } from "../components/server-console";
import { BackupsManager } from "../components/backups-manager";
import { FileEditor } from "../components/file-editor";
import { FilesManager } from "../components/files-manager";
import { NetworkPorts } from "../components/network-ports";
import { RoutesManager } from "../components/routes-manager";
import { SchedulesManager } from "../components/schedules-manager";
import { ServerSettings } from "../components/server-settings";
import { StartupConfiguration } from "../components/startup-configuration";
import { StartupVariables } from "../components/startup-variables";
import { ModPluginBrowser } from "../components/mods/mod-plugin-browser";
import { MinecraftPlayerManager } from "../components/minecraft-player-manager";

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
  const { data: project } = useProject(slug);

  const serverData =
    infoResponse && !infoResponse.error ? infoResponse.data : null;
  const { installing: modpackInstalling } = useModpackJob(
    server,
    hasResourceSupport(serverData?.features ?? []),
  );
  const effectivePermissions = mergePermissions(
    session?.user.permissions ?? 0,
    project?.permissions ?? 0,
  );
  const visibleSections = getVisibleServerSections(
    effectivePermissions,
    serverData?.features ?? [],
    project?.features ?? [],
  );
  const activeSection = getActiveServerSection(visibleSections, section);

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
  const canEditBuild = hasServerPermission(
    effectivePermissions,
    ServerPermission.BUILD_EDIT,
  );
  const canManagePlayers = hasServerPermission(
    effectivePermissions,
    ServerPermission.USER_EDIT,
  );
  const isEditRoute = section?.[0] === "edit";

  return (
    <div className="flex flex-col gap-6">
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
              <Link href={`/${slug}`}>
                {t("servers:shared.backToServerList")}
              </Link>
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
            modpackInstalling={modpackInstalling}
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
          modpackInstalling={modpackInstalling}
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
      ) : activeSection.key === "schedules" ? (
        <SchedulesManager
          serverId={server}
          canManage={hasServerPermission(
            effectivePermissions,
            ServerPermission.SCHEDULE_MANAGE,
          )}
          isMinecraftServer={(serverData?.features ?? []).includes(
            "minecraft_commands",
          )}
        />
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
        <div className="space-y-4">
          <StartupVariables
            canViewSecrets={canViewSecretVariables}
            serverId={server}
          />
          <StartupConfiguration canEdit={canEditBuild} serverId={server} />
        </div>
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
