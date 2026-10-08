import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { searchResourceProjectsAction } from "@/actions/mod-browser";
import type {
  ResourceKind,
  ResourceLoader,
  ResourceProject,
  ResourceProvider,
} from "@/lib/mod-browser/types";

type SearchOptions = {
  serverId: string;
  loader: ResourceLoader | null;
  provider: ResourceProvider | null;
  kind: ResourceKind;
  gameVersion?: string;
};

export function useResourceSearch({
  serverId,
  loader,
  provider,
  kind,
  gameVersion,
}: SearchOptions) {
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ResourceProject[]>([]);
  const [isSearching, startSearch] = useTransition();

  const search = useCallback(
    (nextQuery: string) => {
      if (!loader || !provider) return;

      startSearch(async () => {
        const result = await searchResourceProjectsAction({
          serverId,
          provider,
          query: nextQuery,
          loader,
          kind,
          gameVersion,
        });

        if (result.data) {
          setProjects(result.data);
          return;
        }

        if (result.serverError) toast.error(result.serverError);
        setProjects([]);
      });
    },
    [serverId, loader, provider, kind, gameVersion],
  );

  const searchCurrentQuery = useEffectEvent(() => search(query));

  useEffect(() => {
    searchCurrentQuery();
  }, [search]);

  return {
    query,
    setQuery,
    projects,
    isSearching,
    submit: () => search(query),
  };
}
