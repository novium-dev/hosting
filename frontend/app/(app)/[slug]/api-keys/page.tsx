import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useProject } from "@/hooks/use-project";
import { ApiKeysView } from "./api-keys-view";

export default function ApiKeysPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { data: project, isLoading } = useProject(slug);

  if (isLoading) return null;
  if (!project) return <NotFoundView />;

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug ?? "", href: `/${slug}` },
        { label: t("common:nav.apiKeys") },
      ]}
    >
      <ApiKeysView projectId={project.id} permissions={project.permissions} />
    </MainLayout>
  );
}
