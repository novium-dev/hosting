import { useCallback, useEffect, useState } from "react";

import type { SortState } from "@/hooks/use-table-sort";

export const PAGE_SIZE = 25;

export type Page<T> = {
  items: T[];
  total: number;
  totalPages: number;
};

export function toPage<T>(result: {
  data?: T[];
  response?: Response;
}): Page<T> {
  const items = result.data ?? [];
  const total = Number(result.response?.headers.get("x-total-count"));
  const totalPages = Number(result.response?.headers.get("x-total-pages"));

  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
    totalPages: Number.isFinite(totalPages) ? Math.max(totalPages, 1) : 1,
  };
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  return debounced;
}

export function usePagedTable<TColumn extends string>(
  initial: SortState<TColumn>,
) {
  const [page, setPage] = useState(0);
  const [search, setSearchValue] = useState("");
  const [sort, setSort] = useState<SortState<TColumn>>(initial);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(0);
  }, []);

  const toggle = useCallback((column: TColumn) => {
    setSort((current) =>
      current.column === column
        ? {
            column,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { column, direction: "asc" },
    );
    setPage(0);
  }, []);

  return {
    page,
    setPage,
    search,
    setSearch,
    debouncedSearch,
    sort,
    toggle,
    query: {
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      sort: sort.column,
      order: sort.direction,
    },
  };
}
