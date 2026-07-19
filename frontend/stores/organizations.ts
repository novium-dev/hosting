import { create } from "zustand";
import type { AppOrganization } from "@/lib/auth";

// Cache of full organizations keyed by slug. Populated by `useOrganization`
// (fetch-once per slug) so navigating between an org's pages doesn't refetch.
// Also tracks the last-visited org slug (persisted to localStorage) so landing
// on the root / no-org URL prefers it over just picking the first org.

const CURRENT_ORG_KEY = "novium:current-organization";

function readCurrentSlug(): string | null {
  try {
    return localStorage.getItem(CURRENT_ORG_KEY);
  } catch {
    return null;
  }
}

function persistCurrentSlug(slug: string | null) {
  try {
    if (slug) localStorage.setItem(CURRENT_ORG_KEY, slug);
    else localStorage.removeItem(CURRENT_ORG_KEY);
  } catch {
    // Ignore storage errors (e.g. private mode / disabled storage).
  }
}

type OrganizationState = {
  organizations: Record<string, AppOrganization>;
  currentSlug: string | null;
  setOrganization: (slug: string, organization: AppOrganization) => void;
  setCurrentSlug: (slug: string | null) => void;
  invalidate: (slug: string) => void;
  clear: () => void;
};

export const useOrganizationStore = create<OrganizationState>((set) => ({
  organizations: {},
  currentSlug: readCurrentSlug(),
  setOrganization: (slug, organization) =>
    set((state) => ({
      organizations: { ...state.organizations, [slug]: organization },
    })),
  setCurrentSlug: (slug) => {
    persistCurrentSlug(slug);
    set({ currentSlug: slug });
  },
  invalidate: (slug) =>
    set((state) => {
      const next = { ...state.organizations };
      delete next[slug];
      return { organizations: next };
    }),
  clear: () => {
    persistCurrentSlug(null);
    set({ organizations: {}, currentSlug: null });
  },
}));
