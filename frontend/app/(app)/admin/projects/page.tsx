import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { listProjects } from "@/lib/api";
import { auth } from "@/lib/auth";
import {
  hasManagementPermission,
  ManagementPermission,
} from "@/lib/permissions";
import { ProjectsTable } from "./projects-table";

export const metadata: Metadata = {
  title: "Projects | Hephaestus Admin",
  description: "Browse projects in Hephaestus Admin",
};

export default async function AdminProjectsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (
    !session ||
    !hasManagementPermission(
      session.user.permissions,
      ManagementPermission.SERVER_MANAGE,
    )
  ) {
    notFound();
  }

  const response = await listProjects({
    headers: requestHeaders,
  });

  const projects = response.error ? [] : (response.data ?? []);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ProjectsTable projects={projects} />
    </div>
  );
}
