import { Navigate } from "react-router-dom";
import useSWR from "swr";
import { auth } from "@/lib/auth";

export default function Home() {
  const { data: organizations, isLoading } = useSWR(
    "home/own-organizations",
    () => auth.api.listOrganizations({ own: true }),
  );

  if (isLoading || !organizations) return null;

  const firstOrganization = organizations[0];
  if (!firstOrganization) return <Navigate to="/onboarding" replace />;

  return <Navigate to={`/${firstOrganization.slug}`} replace />;
}
