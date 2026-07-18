import { Navigate, Outlet } from "react-router-dom";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";

export default function AuthLayout() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;
  if (session) return <Navigate to={appConfig.authRoutes.onboarding} replace />;

  return (
    <div className="flex h-svh flex-col items-center justify-center">
      <Outlet />
    </div>
  );
}
