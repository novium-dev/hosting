import { useEffect } from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import { ProjectNavbar } from "@/components/navigation/project-navbar";
import { authClient } from "@/lib/auth-client";
import { useProjectStore } from "@/stores/projects";

export default function SlugLayout() {
  const { slug } = useParams<{ slug: string }>();
  const { data: session, isLoading } = authClient.useSession();
  const setCurrentSlug = useProjectStore((state) => state.setCurrentSlug);

  // Remember the project the user is currently in so the root URL can return here.
  useEffect(() => {
    if (slug) setCurrentSlug(slug);
  }, [slug, setCurrentSlug]);

  if (isLoading) return null;
  if (!session) return <Navigate to="/signin" replace />;

  return (
    <div className="min-h-svh bg-background">
      <ProjectNavbar user={session.user} />
      <main className="mx-auto w-full max-w-400 pb-6">
        <Outlet />
      </main>
    </div>
  );
}
