import { useEffect, useState } from "react";
import { auth } from "@/lib/auth";
import { useOrganizationStore } from "@/stores/organizations";

// Returns the full organization for a slug, cached in the Zustand org store so
// navigating between an org's pages doesn't refetch. Same `{ data, isLoading }`
// shape the callers previously got from SWR.
export function useOrganization(slug: string | undefined) {
  const cached = useOrganizationStore((state) =>
    slug ? state.organizations[slug] : undefined,
  );
  const setOrganization = useOrganizationStore((state) => state.setOrganization);
  const [isLoading, setIsLoading] = useState(!cached);

  useEffect(() => {
    if (!slug || cached) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    auth.api
      .getFullOrganization({ query: { organizationSlug: slug } })
      .then((organization) => {
        if (!active) return;
        if (organization) setOrganization(slug, organization);
        setIsLoading(false);
      })
      .catch(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, cached, setOrganization]);

  return { data: cached ?? null, isLoading };
}
