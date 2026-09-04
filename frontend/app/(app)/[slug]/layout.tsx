import { useEffect } from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import { ProjectHeaderTitle } from "@/components/navigation/project-header-title";
import { ProjectSidebar } from "@/components/navigation/project-sidebar";
import { AppFooter } from "@/components/app-footer";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { useProjectStore } from "@/stores/projects";

export default function SlugLayout() {
  const { slug } = useParams<{ slug: string }>();
  const { data: session, isLoading } = authClient.useSession();
  const setCurrentSlug = useProjectStore((state) => state.setCurrentSlug);

  useEffect(() => {
    if (slug) setCurrentSlug(slug);
  }, [slug, setCurrentSlug]);

  if (isLoading) return null;
  if (!session) return <Navigate to="/signin" replace />;

  return (
    <SidebarProvider>
      <ProjectSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 md:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <ProjectHeaderTitle />
        </header>
        <main className="w-full max-w-400 pb-6">
          <Outlet />
        </main>
        <AppFooter className="mt-auto border-t" />
      </SidebarInset>
    </SidebarProvider>
  );
}
