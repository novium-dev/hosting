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
        slug={slug ?? ""}
        permissions={organization.permissions}
      />
    </MainLayout>
  );
}
