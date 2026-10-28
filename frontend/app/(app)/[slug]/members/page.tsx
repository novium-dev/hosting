import { useParams } from "react-router-dom";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/sidebar/main-layout";
import { NotFoundView } from "@/components/not-found-view";
import { listProjectUsers } from "@/lib/api";
import { useGrantablePermissions } from "@/hooks/use-grantable-permissions";
import { useProject } from "@/hooks/use-project";
import { MembersView } from "./members-view";

export default function MembersPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { data: project, isLoading } = useProject(slug);
  const grantable = useGrantablePermissions(project?.permissions ?? 0);

  const { data: members } = useSWR(
    project ? ["project-users", project.id] : null,
    async ([, projectId]) => {
      const response = await listProjectUsers({
        path: { project_id: projectId },
      });
      return response.error ? [] : (response.data ?? []);
    },
  );

  if (isLoading) return null;
  if (!project) return <NotFoundView />;

  return (
    <MainLayout breadcrumbs={[{ label: t("common:nav.members") }]}>
      <MembersView
        projectId={project.id}
        ownerId={project.owner}
        members={members ?? []}
        grantable={grantable}
      />
    </MainLayout>
  );
}
