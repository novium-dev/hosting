import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useProject } from "@/hooks/use-project";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { InstanceView } from "./instance-view";

export default function DatabaseInstancePage() {
  const { t } = useTranslation();
  const { slug, instance, section } = useParams<{
    slug: string;
    instance: string;
    section: string;
  }>();
  const { data: project, isLoading } = useProject(slug);

  if (isLoading) return null;
  if (!project || !instance) return <NotFoundView />;

  if (
    !hasServerPermission(project.permissions, ServerPermission.DATABASE_VIEW)
  ) {
    return <NotFoundView />;
  }

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug ?? "", href: `/${slug}` },
        { label: t("common:nav.databases"), href: `/${slug}/databases` },
        { label: t("project:databases.instanceBreadcrumb") },
      ]}
    >
      <InstanceView
        projectId={project.id}
        instanceId={instance}
        section={section ?? "databases"}
        permissions={project.permissions}
      />
    </MainLayout>
  );
}
