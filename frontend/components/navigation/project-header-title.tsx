import useSWR from "swr";
import { useTranslation } from "react-i18next";

import { useProject } from "@/hooks/use-project";
import { listProjectInstances, serverInfo } from "@/lib/api";
import {
  getActiveInstanceSection,
  INSTANCE_SECTIONS,
} from "@/lib/instance-sections";
import { useProjectRoute } from "@/lib/project-route";

const sectionTitleKeys: Record<string, string> = {
  members: "common:nav.members",
  databases: "common:nav.databases",
  "api-keys": "common:nav.apiKeys",
  settings: "common:nav.settings",
};

function HeaderTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
      <span className="truncate">{title}</span>
      <span className="text-muted-foreground">/</span>
      <span className="truncate text-muted-foreground">{subtitle}</span>
    </span>
  );
}

export function ProjectHeaderTitle() {
  const { t } = useTranslation();
  const { slug, section, server, serverSection, instance, instanceSection } =
    useProjectRoute();
  const { data: project } = useProject(slug);
  const { data: infoResponse } = useSWR(
    server ? ["server-info", server] : null,
    () => serverInfo({ path: { server_id: server } }),
  );
  const { data: instances } = useSWR(
    instance && project ? ["project-instances", project.id] : null,
    async () => {
      const response = await listProjectInstances({
        path: { project_id: project?.id ?? "" },
      });
      if (response.error) {
        throw new Error(response.error.error?.msg ?? "Failed to load instances");
      }
      return response.data ?? [];
    },
  );

  if (server) {
    const serverData =
      infoResponse && !infoResponse.error ? infoResponse.data : null;
    const sectionLabel =
      serverSection === "edit"
        ? t("servers:page.sections.files.label")
        : t(`servers:page.sections.${serverSection}.label`);

    return (
      <HeaderTitle
        title={serverData?.name ?? t("common:nav.servers")}
        subtitle={sectionLabel}
      />
    );
  }

  if (instance) {
    const instanceData = instances?.find(
      (candidate) => candidate.id === instance,
    );
    const activeSection = getActiveInstanceSection(instanceSection);
    const entry = INSTANCE_SECTIONS.find((item) => item.key === activeSection);

    return (
      <HeaderTitle
        title={
          instanceData?.display ?? t("navigation:projectSidebar.groups.instance")
        }
        subtitle={t(entry?.titleKey ?? "common:nav.databases")}
      />
    );
  }

  const sectionTitleKey = sectionTitleKeys[section];

  return (
    <span className="text-sm font-medium">
      {sectionTitleKey ? t(sectionTitleKey) : t("common:nav.servers")}
    </span>
  );
}
