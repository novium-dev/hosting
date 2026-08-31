import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useOrganization } from "@/hooks/use-organization";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { InstanceView } from "./instance-view";

export default function DatabaseInstancePage() {
  const { t } = useTranslation();
  const { slug, instance } = useParams<{ slug: string; instance: string }>();
  const { data: organization, isLoading } = useOrganization(slug);

  if (isLoading) return null;
  if (!organization || !instance) return <NotFoundView />;

  if (
    !hasServerPermission(
      organization.permissions,
      ServerPermission.DATABASE_VIEW,
    )
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
        projectId={organization.id}
        slug={slug ?? ""}
        instanceId={instance}
        permissions={organization.permissions}
      />
    </MainLayout>
  );
}
