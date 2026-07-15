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

export type PaginationVariant = "compact" | "default" | "embedded" | "stitch";

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
  /** Sufijo del total en variante stitch: "ventas", "productos", etc. */
  entityLabel?: string;
  /** Oculta el texto "Mostrando X a Y de Z" (p. ej. cuando el contenedor padre ya lo muestra). */
  showSummary?: boolean;
};

export function Pagination({
  className,
  isDisabled = false,
  limit,
  onLimitChange,
  onSkipChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  entityLabel = "registros",
  showSummary = true,
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
  const isEmbedded = variant === "embedded";
  const isStitch = variant === "stitch";

  return (
    <nav
      aria-label="Paginacion de resultados"
      className={cn(
        "flex max-w-full min-w-0 flex-col gap-3",
        isStitch
          ? "flex-row items-center justify-between gap-4"
          : isEmbedded
            ? "gap-3 sm:flex-row sm:items-center sm:justify-between"
            : cn(
                "rounded-lg border border-border bg-surface-container-lowest px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900",
                isCompact ? "gap-3" : "gap-4 sm:flex-row sm:items-center sm:justify-between",
              ),
        className,
      )}
    >
      {showSummary ? (
        <p
          className={cn(
            "shrink-0 text-sm",
            isStitch
              ? "text-on-surface-variant"
              : "text-slate-600 dark:text-slate-400",
          )}
        >
          {total > 0 ? (
            isStitch ? (
              <>
                Mostrando {from} a {to} de {total} {entityLabel}
              </>
            ) : (
              <>
                Mostrando <span className="font-medium text-slate-900 dark:text-slate-100">{from}</span>
                {" - "}
                <span className="font-medium text-slate-900 dark:text-slate-100">{to}</span> de{" "}
                <span className="font-medium text-slate-900 dark:text-slate-100">{total}</span>
              </>
            )
          ) : (
            "Sin resultados"
          )}
        </p>
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2",
          isStitch ? "gap-1" : isCompact ? "justify-between" : "flex-col gap-3 sm:flex-row sm:items-center",
        )}
      >
        {showPageSizeSelector && !isStitch ? (
          <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Por pagina</span>
            <select
              aria-label="Resultados por pagina"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none transition-colors focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-950"
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
          {isStitch ? (
            <Button
              className={cn(
                "h-auto px-3 py-1 text-sm",
                !canGoPrevious && "cursor-not-allowed text-slate-400",
              )}
              disabled={isDisabled || !canGoPrevious}
              onClick={() => goToPage(currentPage - 1)}
              size="sm"
              variant="outline"
            >
              Anterior
            </Button>
          ) : (
            <IconButton
              aria-label="Pagina anterior"
              disabled={isDisabled || !canGoPrevious}
              icon={<ChevronLeft className="h-4 w-4" />}
              onClick={() => goToPage(currentPage - 1)}
              variant="outline"
            />
          )}

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
                      isStitch ? "h-auto min-w-9 px-3 py-1 text-sm" : "min-w-9 px-2",
                      page === currentPage &&
                        (isStitch
                          ? "border-primary bg-primary text-primary-foreground hover:bg-indigo-700"
                          : "bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"),
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

          {isStitch ? (
            <Button
              className="h-auto px-3 py-1 text-sm"
              disabled={isDisabled || !canGoNext}
              onClick={() => goToPage(currentPage + 1)}
              size="sm"
              variant="outline"
            >
              Siguiente
            </Button>
          ) : (
            <IconButton
              aria-label="Pagina siguiente"
              disabled={isDisabled || !canGoNext}
              icon={<ChevronRight className="h-4 w-4" />}
              onClick={() => goToPage(currentPage + 1)}
              variant="outline"
            />
          )}
        </div>

        {!isCompact && !isStitch ? (
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
