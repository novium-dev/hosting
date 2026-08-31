import { Navigate } from "react-router-dom";
import useSWR from "swr";
import { auth } from "@/lib/auth";
import { useProjectStore } from "@/stores/projects";

export default function Home() {
  const { data: projects, isLoading } = useSWR("home/own-projects", () =>
    auth.api.listProjects({ own: true }),
  );
  const currentSlug = useProjectStore((state) => state.currentSlug);

  if (isLoading || !projects) return null;

  if (projects.length === 0) return <Navigate to="/onboarding" replace />;

  // Prefer the last-visited project (if the user still has access), else the first.
  const preferred =
    currentSlug && projects.some((project) => project.slug === currentSlug)
      ? currentSlug
      : projects[0].slug;

  return <Navigate to={`/${preferred}`} replace />;
}
