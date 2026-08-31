import useSWR from "swr";
import { auth } from "@/lib/auth";
import { ProjectDropdown } from "./project-dropdown";

export function ProjectSwitcher() {
  const { data: projects } = useSWR("switcher/own-projects", () =>
    auth.api.listProjects({ own: true }),
  );

  return <ProjectDropdown projects={projects ?? []} />;
}
