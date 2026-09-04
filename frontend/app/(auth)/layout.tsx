import { Navigate, Outlet } from "react-router-dom";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { AppFooter } from "@/components/app-footer";

export default function AuthLayout() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;
  if (session) return <Navigate to={appConfig.authRoutes.onboarding} replace />;

  return (
    <div className="flex h-svh flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <Outlet />
      </div>
      <AppFooter />
    </div>
  );
}
