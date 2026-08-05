import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useOrganization } from "@/hooks/use-organization";
import { ApiKeysView } from "./api-keys-view";

export default function ApiKeysPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { data: organization, isLoading } = useOrganization(slug);

  if (isLoading) return null;
  if (!organization) return <NotFoundView />;

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug ?? "", href: `/${slug}` },
        { label: t("org:apiKeys.title") },
      ]}
    >
      <ApiKeysView
        projectId={organization.id}
        permissions={organization.permissions}
      />
    </MainLayout>
  );
}
