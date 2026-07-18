import { Navigate, Outlet } from "react-router-dom";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";

// Auth guard for the whole authenticated app group (replaces the old Next
// middleware). Children can assume an authenticated session below this.
export default function AppLayout() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;
  if (!session) return <Navigate to={appConfig.authRoutes.signin} replace />;

  return <Outlet />;
}
