import { MainLayout } from "@/components/sidebar/main-layout";
import { listProjectUsers } from "@/lib/api";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MembersView } from "./members-view";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const requestHeaders = await headers();

  const organization = await auth.api.getFullOrganization({
    query: { organizationSlug: slug },
    headers: requestHeaders,
  });

  if (!organization) {
    notFound();
  }

  const response = await listProjectUsers({
    path: { project_id: organization.id },
    headers: requestHeaders,
  });

  const members = response.error ? [] : (response.data ?? []);

  return (
    <MainLayout breadcrumbs={[{ label: "Members" }]}>
      <MembersView projectId={organization.id} members={members} />
    </MainLayout>
  );
}
