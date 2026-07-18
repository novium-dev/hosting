import useSWR from "swr";
import { auth } from "@/lib/auth";

// Client-side fetch of the full organization for a slug. Shared by the pages
// that previously resolved it server-side via `getFullOrganization`.
export function useOrganization(slug: string | undefined) {
  return useSWR(slug ? ["organization", slug] : null, () =>
    auth.api.getFullOrganization({ query: { organizationSlug: slug! } }),
  );
}
