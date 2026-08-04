import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useOrganization } from "@/hooks/use-organization";
import { ServerPermission, hasServerPermission } from "@/lib/permissions";
import { DatabasesView } from "./databases-view";

export default function DatabasesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: organization, isLoading } = useOrganization(slug);

  if (isLoading) return null;
  if (!organization) return <NotFoundView />;

  // Members without DATABASE_VIEW cannot see the databases or their
  // credentials; the backend refuses them too.
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
        { label: "Databases" },
      ]}
    >
      <DatabasesView
        projectId={organization.id}
        permissions={organization.permissions}
      />
    </MainLayout>
  );
}
