import { useParams } from "react-router-dom";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { useOrganization } from "@/hooks/use-organization";
import { ApiKeysView } from "./api-keys-view";

export default function ApiKeysPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: organization, isLoading } = useOrganization(slug);

  if (isLoading) return null;
  if (!organization) return <NotFoundView />;

  return (
    <MainLayout
      breadcrumbs={[
        { label: slug ?? "", href: `/${slug}` },
        { label: "API keys" },
      ]}
    >
      <ApiKeysView
        projectId={organization.id}
        permissions={organization.permissions}
      />
    </MainLayout>
  );
}
