"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { PAGE_SIZE } from "@/hooks/use-paged-table";

export function TablePagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();

  if (total === 0) return null;

  const from = page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <nav
      aria-label={t("common:pagination.label")}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {t("common:pagination.summary", { from, to, total })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("common:pagination.goToPreviousPage")}
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon className="size-4" />
          <span className="hidden sm:inline">
            {t("common:pagination.previous")}
          </span>
        </Button>
        <span className="text-sm tabular-nums">
          {t("common:pagination.pageOf", {
            page: page + 1,
            pages: totalPages,
          })}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("common:pagination.goToNextPage")}
          disabled={page + 1 >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <span className="hidden sm:inline">
            {t("common:pagination.next")}
          </span>
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </nav>
  );
}
