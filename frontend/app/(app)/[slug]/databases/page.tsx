import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useProject } from "@/hooks/use-project";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { DatabasesView } from "./databases-view";

export default function DatabasesPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { data: project, isLoading } = useProject(slug);

  if (isLoading) return null;
  if (!project) return <NotFoundView />;

  if (
    !hasServerPermission(project.permissions, ServerPermission.DATABASE_VIEW)
  ) {
    return <NotFoundView />;
  }

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug ?? "", href: `/${slug}` },
        { label: t("common:nav.databases") },
      ]}
    >
      <DatabasesView
        projectId={project.id}
        slug={slug ?? ""}
        permissions={project.permissions}
      />
    </MainLayout>
  );
}
