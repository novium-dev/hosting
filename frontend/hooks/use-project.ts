import { useEffect, useState } from "react";
import { auth } from "@/lib/auth";
import { useProjectStore } from "@/stores/projects";

// Returns the full project for a slug, cached in the Zustand project store so
// navigating between a project's pages doesn't refetch. Same `{ data, isLoading }`
// shape the callers previously got from SWR.
export function useProject(slug: string | undefined) {
  const cached = useProjectStore((state) =>
    slug ? state.projects[slug] : undefined,
  );
  const setProject = useProjectStore((state) => state.setProject);
  const [isLoading, setIsLoading] = useState(!cached);

  useEffect(() => {
    if (!slug || cached) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    auth.api
      .getFullProject({ query: { projectSlug: slug } })
      .then((project) => {
        if (!active) return;
        if (project) setProject(slug, project);
        setIsLoading(false);
      })
      .catch(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, cached, setProject]);

  return { data: cached ?? null, isLoading };
}
