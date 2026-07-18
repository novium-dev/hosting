import { useMemo } from "react";
import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from "react-router-dom";

// Compatibility shim for `next/navigation` on top of react-router. Covers the
// subset used across the app so call sites only need their import path changed.

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      // No SSR cache to bust in an SPA; SWR revalidation handles freshness.
      refresh: () => {},
      prefetch: () => {},
    }),
    [navigate],
  );
}

export function usePathname() {
  return useLocation().pathname;
}

export const useParams = useRouterParams;

// Next's `useSearchParams` returns just a readonly URLSearchParams; react-router
// returns a [params, setter] tuple. Expose the Next shape.
export function useSearchParams() {
  const [searchParams] = useRouterSearchParams();
  return searchParams;
}

export enum RedirectType {
  push = "push",
  replace = "replace",
}

// Imperative redirect for non-render contexts (event handlers, effects).
export function redirect(href: string): never {
  window.location.assign(href);
  throw new Error("redirect");
}

export function permanentRedirect(href: string): never {
  return redirect(href);
}

export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
