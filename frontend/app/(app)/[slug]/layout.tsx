import { OrganizationNavbar } from "@/components/navigation/organization-navbar";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function SlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/signin");
  }

  return (
    <div className="min-h-svh bg-background">
      <OrganizationNavbar user={session.user} />
      <main className="mx-auto w-full max-w-400 pb-6">{children}</main>
    </div>
  );
}
