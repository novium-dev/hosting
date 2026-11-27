import { RedirectToSignin } from "@/lib/auth-redirect";
import { Outlet } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { SettingsDialog } from "@/components/settings/settings-dialog";

// Auth guard for the whole authenticated app group (replaces the old Next
// middleware). Children can assume an authenticated session below this.
export default function AppLayout() {
  const { data: session, isLoading } = authClient.useSession();

  if (isLoading) return null;
  if (!session) return <RedirectToSignin />;

  return (
    <>
      <Outlet />
      <SettingsDialog />
    </>
  );
}
