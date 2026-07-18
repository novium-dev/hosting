import { Outlet } from "react-router-dom";
import { MainLayout } from "@/components/sidebar/main-layout";

export default function ProfileLayout() {
  return (
    <MainLayout breadcrumbs={[{ label: "Profile" }]}>
      <main className="mx-auto w-full max-w-4xl px-0 md:px-4">
        <Outlet />
      </main>
    </MainLayout>
  );
}
