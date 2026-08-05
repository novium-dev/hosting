import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useOrganization } from "@/hooks/use-organization";
import { OrganizationSettings } from "./organization-settings";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { data: organization, isLoading } = useOrganization(slug);

  if (isLoading) return null;
  if (!organization) return <NotFoundView />;

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug ?? "", href: `/${slug}` },
        { label: t("org:settings.title") },
      ]}
    >
      <OrganizationSettings organization={organization} />
    </MainLayout>
  );
}
