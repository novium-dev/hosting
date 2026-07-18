import { MainLayout } from "@/components/sidebar/main-layout";
import { appConfig } from "@/constants/config";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { OrganizationSettings } from "./organization-settings";
import { notFound } from "next/navigation";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const organization = await auth.api.getFullOrganization({
    query: { organizationSlug: slug },
    headers: await headers(),
  });

  if (!organization) return notFound();

  return (
    <MainLayout
      breadcrumbs={[{ label: slug, href: `/${slug}` }, { label: "Settings" }]}
    >
      <OrganizationSettings organization={organization} />
    </MainLayout>
  );
}
