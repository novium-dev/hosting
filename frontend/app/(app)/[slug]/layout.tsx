import { Navigate, Outlet } from "react-router-dom";
import { OrganizationNavbar } from "@/components/navigation/organization-navbar";
import { authClient } from "@/lib/auth-client";

export default function SlugLayout() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;
  if (!session) return <Navigate to="/signin" replace />;

  return (
    <div className="min-h-svh bg-background">
      <OrganizationNavbar user={session.user} />
      <main className="mx-auto w-full max-w-400 pb-6">
        <Outlet />
      </main>
    </div>
  );
}
