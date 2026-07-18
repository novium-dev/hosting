import { appConfig } from "@/constants/config";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect(appConfig.authRoutes.signin);

  const organizations = await auth.api.listOrganizations({
    own: true,
    headers: await headers(),
  });

  const firstOrganization = organizations[0];

  if (!firstOrganization) {
    redirect("/onboarding");
  }

  redirect(`/${firstOrganization.slug}`);
}
