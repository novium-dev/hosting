import useSWR from "swr";
import { auth } from "@/lib/auth";
import { useProjectStore } from "@/stores/projects";

export function useProject(slug: string | undefined) {
  const cached = useProjectStore((state) =>
    slug ? state.projects[slug] : undefined,
  );
  const setProject = useProjectStore((state) => state.setProject);

  const { isLoading } = useSWR(
    slug && !cached ? ["full-project", slug] : null,
    ([, projectSlug]) =>
      auth.api.getFullProject({ query: { projectSlug } }),
    {
      onSuccess: (project) => {
        if (slug && project) setProject(slug, project);
      },
    },
  );

  return { data: cached ?? null, isLoading: !cached && isLoading };
}
