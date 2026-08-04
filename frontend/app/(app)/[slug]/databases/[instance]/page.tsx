import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useOrganization } from "@/hooks/use-organization";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { InstanceView } from "./instance-view";

export default function DatabaseInstancePage() {
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
        { label: "Databases", href: `/${slug}/databases` },
        { label: "Instance" },
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
