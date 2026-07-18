import { create } from "zustand";
import type { AppOrganization } from "@/lib/auth";

// Cache of full organizations keyed by slug. Populated by `useOrganization`
// (fetch-once per slug) so navigating between an org's pages doesn't refetch.

type OrganizationState = {
  organizations: Record<string, AppOrganization>;
  setOrganization: (slug: string, organization: AppOrganization) => void;
  invalidate: (slug: string) => void;
  clear: () => void;
};

export const useOrganizationStore = create<OrganizationState>((set) => ({
  organizations: {},
  setOrganization: (slug, organization) =>
    set((state) => ({
      organizations: { ...state.organizations, [slug]: organization },
    })),
  invalidate: (slug) =>
    set((state) => {
      const next = { ...state.organizations };
      delete next[slug];
      return { organizations: next };
    }),
  clear: () => set({ organizations: {} }),
}));
