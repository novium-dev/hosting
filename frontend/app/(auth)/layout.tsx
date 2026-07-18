import { appConfig } from "@/constants/config";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (session) redirect(appConfig.authRoutes.onboarding);

  return (
    <div className="flex h-svh flex-col items-center justify-center">
      {children}
    </div>
  );
}
