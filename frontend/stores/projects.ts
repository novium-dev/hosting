import { create } from "zustand";
import type { AppProject } from "@/lib/auth";

// Cache of full projects keyed by slug. Populated by `useProject`
// (fetch-once per slug) so navigating between a project's pages doesn't refetch.
// Also tracks the last-visited project slug (persisted to localStorage) so landing
// on the root / no-project URL prefers it over just picking the first project.

const CURRENT_PROJECT_KEY = "novium:current-project";

function readCurrentSlug(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

function persistCurrentSlug(slug: string | null) {
  try {
    if (slug) localStorage.setItem(CURRENT_PROJECT_KEY, slug);
    else localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    // Ignore storage errors (e.g. private mode / disabled storage).
  }
}

type ProjectState = {
  projects: Record<string, AppProject>;
  currentSlug: string | null;
  setProject: (slug: string, project: AppProject) => void;
  setCurrentSlug: (slug: string | null) => void;
  invalidate: (slug: string) => void;
  clear: () => void;
};

export const useProjectStore = create<ProjectState>((set) => ({
  projects: {},
  currentSlug: readCurrentSlug(),
  setProject: (slug, project) =>
    set((state) => ({
      projects: { ...state.projects, [slug]: project },
    })),
  setCurrentSlug: (slug) => {
    persistCurrentSlug(slug);
    set({ currentSlug: slug });
  },
  invalidate: (slug) =>
    set((state) => {
      const next = { ...state.projects };
      delete next[slug];
      return { projects: next };
    }),
  clear: () => {
    persistCurrentSlug(null);
    set({ projects: {}, currentSlug: null });
  },
}));
