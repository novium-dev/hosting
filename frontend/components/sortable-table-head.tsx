"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { TableHead } from "@/components/ui/table";
import type { SortState } from "@/hooks/use-table-sort";
import { cn } from "@/lib/utils";

export function SortableTableHead<TColumn extends string>({
  column,
  sort,
  onSort,
  align = "left",
  className,
  children,
}: {
  column: TColumn;
  sort: SortState<TColumn>;
  onSort: (column: TColumn) => void;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const active = sort.column === column;
  const Icon = !active
    ? ChevronsUpDownIcon
    : sort.direction === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon;

  return (
    <TableHead
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={cn(align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "-mx-2 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "text-foreground" : "text-muted-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        <span className="truncate">{children}</span>
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            active ? "opacity-100" : "opacity-40",
          )}
        />
      </button>
    </TableHead>
  );
}
