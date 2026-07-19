import { Navigate } from "react-router-dom";
import useSWR from "swr";
import { auth } from "@/lib/auth";
import { useOrganizationStore } from "@/stores/organizations";

export default function Home() {
  const { data: organizations, isLoading } = useSWR(
    "home/own-organizations",
    () => auth.api.listOrganizations({ own: true }),
  );
  const currentSlug = useOrganizationStore((state) => state.currentSlug);

  if (isLoading || !organizations) return null;

  if (organizations.length === 0) return <Navigate to="/onboarding" replace />;

  // Prefer the last-visited org (if the user still has access), else the first.
  const preferred =
    currentSlug && organizations.some((org) => org.slug === currentSlug)
      ? currentSlug
      : organizations[0].slug;

  return <Navigate to={`/${preferred}`} replace />;
}
