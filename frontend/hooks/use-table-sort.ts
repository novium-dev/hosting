import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export type SortValue = string | number | boolean | null | undefined;

export type SortState<TColumn extends string> = {
  column: TColumn;
  direction: SortDirection;
};

export type SortAccessors<TRow, TColumn extends string> = Record<
  TColumn,
  (row: TRow) => SortValue
>;

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compare(left: SortValue, right: SortValue) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return collator.compare(String(left), String(right));
}

export function useTableSort<TRow, TColumn extends string>(
  rows: TRow[],
  accessors: SortAccessors<TRow, TColumn>,
  initial: SortState<TColumn>,
) {
  const [sort, setSort] = useState<SortState<TColumn>>(initial);

  const toggle = useCallback((column: TColumn) => {
    setSort((current) =>
      current.column === column
        ? {
            column,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { column, direction: "asc" },
    );
  }, []);

  const sorted = useMemo(() => {
    const accessor = accessors[sort.column];
    if (!accessor) return rows;

    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort(
      (left, right) => factor * compare(accessor(left), accessor(right)),
    );
  }, [accessors, rows, sort]);

  return { rows: sorted, sort, toggle };
}
