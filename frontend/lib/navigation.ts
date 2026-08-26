import { useMemo } from "react";
import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => navigate(-1),
    }),
    [navigate],
  );
}

export function usePathname() {
  return useLocation().pathname;
}

export const useParams = useRouterParams;

// react-router returns a [params, setter] tuple; call sites only read.
export function useSearchParams() {
  const [searchParams] = useRouterSearchParams();
  return searchParams;
}
