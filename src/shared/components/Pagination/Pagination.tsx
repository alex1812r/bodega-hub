"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MIN_PAGE_LIMIT } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { IconButton } from "@/shared/components/IconButton";
import { cn } from "@/shared/utils/cn";

import {
  getCurrentPage,
  getItemRange,
  getSkipForPage,
  getTotalPages,
  getVisiblePageRange,
} from "./pagination-utils";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export type PaginationVariant = "default" | "compact";

export type PaginationProps = {
  className?: string;
  isDisabled?: boolean;
  limit: number;
  onLimitChange?: (limit: number) => void;
  onSkipChange: (skip: number) => void;
  pageSizeOptions?: number[];
  skip: number;
  total: number;
  /** Use in narrow containers (e.g. dashboard cards) to avoid horizontal overflow. */
  variant?: PaginationVariant;
};

export function Pagination({
  className,
  isDisabled = false,
  limit,
  onLimitChange,
  onSkipChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  skip,
  total,
  variant = "default",
}: PaginationProps) {
  const currentPage = getCurrentPage(skip, limit);
  const totalPages = getTotalPages(total, limit);
  const { from, to } = getItemRange(skip, limit, total);
  const visiblePages = getVisiblePageRange(currentPage, totalPages);
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const showPageSizeSelector = Boolean(onLimitChange);
  const normalizedPageSizeOptions = pageSizeOptions.filter(
    (option) => option >= MIN_PAGE_LIMIT && option <= MAX_PAGE_LIMIT,
  );
  const resolvedPageSizeOptions = normalizedPageSizeOptions.length
    ? normalizedPageSizeOptions
    : [DEFAULT_PAGE_LIMIT];

  const goToPage = (page: number) => {
    if (isDisabled || page < 1 || page > totalPages || page === currentPage) {
      return;
    }

    onSkipChange(getSkipForPage(page, limit));
  };

  const handleLimitChange = (nextLimit: number) => {
    if (isDisabled || !onLimitChange || nextLimit === limit) {
      return;
    }

    onLimitChange(nextLimit);
    onSkipChange(0);
  };

  const isCompact = variant === "compact";

  return (
    <nav
      aria-label="Paginacion de resultados"
      className={cn(
        "flex max-w-full min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900",
        isCompact ? "gap-3" : "gap-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="shrink-0 text-sm text-slate-600 dark:text-slate-400">
        {total > 0 ? (
          <>
            Mostrando <span className="font-medium text-slate-900 dark:text-slate-100">{from}</span>
            {" - "}
            <span className="font-medium text-slate-900 dark:text-slate-100">{to}</span> de{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">{total}</span>
          </>
        ) : (
          "Sin resultados"
        )}
      </p>

      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2",
          isCompact ? "justify-between" : "flex-col gap-3 sm:flex-row sm:items-center",
        )}
      >
        {showPageSizeSelector ? (
          <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Por pagina</span>
            <select
              aria-label="Resultados por pagina"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-950"
              disabled={isDisabled}
              onChange={(event) => handleLimitChange(Number(event.target.value))}
              value={limit}
            >
              {resolvedPageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex min-w-0 shrink items-center gap-1">
          <IconButton
            aria-label="Pagina anterior"
            disabled={isDisabled || !canGoPrevious}
            icon={<ChevronLeft className="h-4 w-4" />}
            onClick={() => goToPage(currentPage - 1)}
            variant="outline"
          />

          {isCompact ? (
            <p className="whitespace-nowrap px-1 text-sm text-slate-500 dark:text-slate-400">
              Pagina{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">{currentPage}</span> de{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">{totalPages}</span>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {visiblePages.map((page, index) =>
                page === -1 ? (
                  <span
                    aria-hidden="true"
                    className="px-2 text-sm text-slate-400 dark:text-slate-500"
                    key={`ellipsis-${index}`}
                  >
                    ...
                  </span>
                ) : (
                  <Button
                    aria-current={page === currentPage ? "page" : undefined}
                    aria-label={`Ir a pagina ${page}`}
                    className={cn(
                      "min-w-9 px-2",
                      page === currentPage &&
                        "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700",
                    )}
                    disabled={isDisabled}
                    key={page}
                    onClick={() => goToPage(page)}
                    size="sm"
                    variant={page === currentPage ? "primary" : "outline"}
                  >
                    {page}
                  </Button>
                ),
              )}
            </div>
          )}

          <IconButton
            aria-label="Pagina siguiente"
            disabled={isDisabled || !canGoNext}
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => goToPage(currentPage + 1)}
            variant="outline"
          />
        </div>

        {!isCompact ? (
          <p className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
            Pagina{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">{currentPage}</span> de{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">{totalPages}</span>
          </p>
        ) : null}
      </div>
    </nav>
  );
}
