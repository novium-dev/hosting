import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { listProjectUsers } from "@/lib/api";
import { useOrganization } from "@/hooks/use-organization";
import { MembersView } from "./members-view";

export default function MembersPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { data: organization, isLoading } = useOrganization(slug);

  const { data: members } = useSWR(
    organization ? ["project-users", organization.id] : null,
    async () => {
      const response = await listProjectUsers({
        path: { project_id: organization!.id },
      });
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!organization) return <NotFoundView />;

  return (
    <MainLayout breadcrumbs={[{ label: t("common:nav.members") }]}>
      <MembersView projectId={organization.id} members={members ?? []} />
    </MainLayout>
  );
}
