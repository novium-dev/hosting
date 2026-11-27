import { Navigate, Outlet } from "react-router-dom";
import { appConfig } from "@/constants/config";
import { authClient } from "@/lib/auth-client";
import { useSigninRedirect } from "@/lib/auth-redirect";
import { AppFooter } from "@/components/app-footer";

export default function AuthLayout() {
  const { data: session, isLoading } = authClient.useSession();
  const redirect = useSigninRedirect();

  if (isLoading) return null;
  if (session) {
    return (
      <Navigate to={redirect ?? appConfig.authRoutes.onboarding} replace />
    );
  }

  return (
    <div className="flex h-svh flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <Outlet />
      </div>
      <AppFooter />
    </div>
  );
}
