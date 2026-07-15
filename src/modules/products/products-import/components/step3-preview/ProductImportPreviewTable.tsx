"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { CategoryMock } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import type { ProductImportRowDraft } from "../../services/validateProductImportRows";
import type { ProductImportValidatedRow } from "../../types";
import { ProductImportValidationStatusBadge } from "../shared/ProductImportValidationStatusBadge";
import { ProductImportRowEditModal } from "./ProductImportRowEditModal";
import { ProductImportRowReasonModal } from "./ProductImportRowReasonModal";

const PAGE_SIZE = 25;

export type ProductImportPreviewFilter = "all" | "errors" | "valid";

type ProductImportPreviewTableProps = {
  categories: CategoryMock[];
  filter: ProductImportPreviewFilter;
  onFilterChange: (filter: ProductImportPreviewFilter) => void;
  onUpdateRow: (draft: ProductImportRowDraft) => void;
  rows: ProductImportValidatedRow[];
};

function formatPrice(value: number | undefined, hasError: boolean): string {
  if (hasError || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(2);
}

export function ProductImportPreviewTable({
  categories,
  filter,
  onFilterChange,
  onUpdateRow,
  rows,
}: ProductImportPreviewTableProps) {
  const [page, setPage] = useState(1);
  const [reasonRow, setReasonRow] = useState<ProductImportValidatedRow | null>(null);
  const [editRow, setEditRow] = useState<ProductImportValidatedRow | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const filteredRows = useMemo(() => {
    if (filter === "errors") {
      return rows.filter((row) => row.status === "error");
    }

    if (filter === "valid") {
      return rows.filter((row) => row.status !== "error");
    }

    return rows;
  }, [filter, rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const rangeStart = filteredRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filteredRows.length);

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-outline-variant bg-surface-bright p-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-on-surface">Vista Previa de Datos</h3>
          <div className="flex items-center gap-2">
            <label
              className="text-xs font-medium text-on-surface-variant"
              htmlFor="import-preview-filter"
            >
              Filtro:
            </label>
            <select
              className="rounded border border-outline-variant bg-surface px-3 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              id="import-preview-filter"
              onChange={(event) => {
                onFilterChange(event.target.value as ProductImportPreviewFilter);
                setPage(1);
              }}
              value={filter}
            >
              <option value="all">Todos</option>
              <option value="errors">Solo Errores</option>
              <option value="valid">Solo Válidos</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full border-collapse text-left">
            <thead className="border-b border-outline-variant bg-surface-container-low text-xs font-semibold tracking-wider text-on-surface-variant uppercase">
              <tr>
                <th className="w-16 px-4 py-3">Fila</th>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Nombre Producto</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3 text-right">Precio ($)</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="w-36 px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50 font-mono text-sm text-on-surface">
              {pageRows.map((row) => {
                const price = row.input?.salePriceRef;
                const priceInvalid =
                  row.status === "error" &&
                  row.messages.some((message) => message.toLowerCase().includes("precio"));
                const categoryName = row.input?.categoryId
                  ? (categoryById.get(row.input.categoryId) ?? "—")
                  : "—";
                const hasReason = row.messages.length > 0;

                return (
                  <tr
                    className={cn(
                      "transition-colors hover:bg-surface-container-lowest",
                      row.status === "error" &&
                        "bg-error-container/20 hover:bg-error-container/30",
                    )}
                    key={row.rowIndex}
                  >
                    <td className="px-4 py-3 text-outline">{row.rowIndex}</td>
                    <td className="px-4 py-3 font-medium">{row.sku}</td>
                    <td className="px-4 py-3 font-sans">{row.name}</td>
                    <td className="px-4 py-3 font-sans">{categoryName}</td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right",
                        priceInvalid && "font-bold text-error",
                      )}
                    >
                      {formatPrice(price, priceInvalid)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.input?.currentStock ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center font-sans">
                      <ProductImportValidationStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-center font-sans">
                      <div className="flex flex-col items-center gap-1">
                        <button
                          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setEditRow(row)}
                          type="button"
                        >
                          Editar
                        </button>
                        {hasReason ? (
                          <button
                            className="text-xs font-medium text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline"
                            onClick={() => setReasonRow(row)}
                            type="button"
                          >
                            Ver motivo
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-outline-variant bg-surface-bright p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-on-surface-variant">
            Mostrando {rangeStart} a {rangeEnd} de {filteredRows.length} filas
          </span>
          <div className="flex items-center gap-1">
            <button
              className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
              disabled={safePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </button>
            <span className="flex size-8 items-center justify-center rounded bg-primary text-xs font-medium text-on-primary">
              {safePage}
            </span>
            <button
              className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
              disabled={safePage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              type="button"
            >
              <ChevronRight aria-hidden className="size-5" />
            </button>
          </div>
        </div>
      </div>

      <ProductImportRowReasonModal
        categories={categories}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setReasonRow(null);
          }
        }}
        open={reasonRow !== null}
        row={reasonRow}
      />

      <ProductImportRowEditModal
        categories={categories}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setEditRow(null);
          }
        }}
        onSave={onUpdateRow}
        open={editRow !== null}
        row={editRow}
      />
    </>
  );
}
