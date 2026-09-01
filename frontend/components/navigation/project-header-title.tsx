import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { serverInfo } from "@/lib/api";
import { useProjectRoute } from "@/lib/project-route";

const sectionTitleKeys: Record<string, string> = {
  members: "common:nav.members",
  databases: "common:nav.databases",
  "api-keys": "common:nav.apiKeys",
  settings: "common:nav.settings",
};

export function ProjectHeaderTitle() {
  const { t } = useTranslation();
  const { section, server, serverSection } = useProjectRoute();
  const { data: infoResponse } = useSWR(
    server ? ["server-info", server] : null,
    () => serverInfo({ path: { server_id: server } }),
  );

  if (server) {
    const serverData =
      infoResponse && !infoResponse.error ? infoResponse.data : null;
    const sectionLabel =
      serverSection === "edit"
        ? t("servers:page.sections.files.label")
        : t(`servers:page.sections.${serverSection}.label`);

    return (
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <span className="truncate">
          {serverData?.name ?? t("common:nav.servers")}
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-muted-foreground">{sectionLabel}</span>
      </span>
    );
  }

  const sectionTitleKey = sectionTitleKeys[section];

  return (
    <span className="text-sm font-medium">
      {sectionTitleKey
        ? t(sectionTitleKey)
        : t("navigation:projectSidebar.dashboard")}
    </span>
  );
}
