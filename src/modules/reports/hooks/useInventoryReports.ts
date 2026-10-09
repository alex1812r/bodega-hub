"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginationParams } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import type {
  DeadStockReport,
  StockAdjustmentsReport,
  StockTurnoverGroupBy,
  StockTurnoverReport,
} from "../services/inventoryReports";
import type { MoneyReportRange } from "../services/moneyReports";
import type { ReportGroupBy } from "../services/reportSeries";

/** Reportes de inventario (REP-07). Los tres son de solo lectura y por tienda. */

export type InventoryReportHookOptions = { enabled?: boolean };

export type DeadStockFilters = PaginationParams & {
  categoryId?: string;
  /** Días sin vender (1–3650); 30 si no se manda. */
  days?: number;
};

export type StockTurnoverFilters = PaginationParams &
  Partial<MoneyReportRange> & {
    groupBy?: StockTurnoverGroupBy;
  };

export type StockAdjustmentsFilters = PaginationParams &
  Partial<MoneyReportRange> & {
    /** Sin valor (o `auto`), la agrupación depende del nº de días del rango. */
    groupBy?: ReportGroupBy | "auto";
  };

export const inventoryReportsQueryKeys = {
  all: ["reports", "inventory"] as const,
  deadStock: (filters: DeadStockFilters) => ["reports", "inventory", "dead-stock", filters] as const,
  stockAdjustments: (filters: StockAdjustmentsFilters) =>
    ["reports", "inventory", "stock-adjustments", filters] as const,
  stockTurnover: (filters: StockTurnoverFilters) =>
    ["reports", "inventory", "stock-turnover", filters] as const,
};

function hasRange(range: Partial<MoneyReportRange>) {
  return Boolean(range.from && range.to);
}

/** Productos sin movimiento con su valor inmovilizado, paginados. */
export function useDeadStockReport(
  filters: DeadStockFilters = {},
  options: InventoryReportHookOptions = {},
) {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: inventoryReportsQueryKeys.deadStock(filters),
    queryFn: () => apiFetch<DeadStockReport>("/api/reports/dead-stock", { query: filters }),
  });
}

/** Rotación por producto o por categoría. No consulta sin `from` y `to`. */
export function useStockTurnoverReport(
  filters: StockTurnoverFilters,
  options: InventoryReportHookOptions = {},
) {
  return useQuery({
    enabled: (options.enabled ?? true) && hasRange(filters),
    queryKey: inventoryReportsQueryKeys.stockTurnover(filters),
    queryFn: () => apiFetch<StockTurnoverReport>("/api/reports/stock-turnover", { query: filters }),
  });
}

/** Ajustes y mermas por motivo y periodo. No consulta sin `from` y `to`. */
export function useStockAdjustmentsReport(
  filters: StockAdjustmentsFilters,
  options: InventoryReportHookOptions = {},
) {
  return useQuery({
    enabled: (options.enabled ?? true) && hasRange(filters),
    queryKey: inventoryReportsQueryKeys.stockAdjustments(filters),
    queryFn: () =>
      apiFetch<StockAdjustmentsReport>("/api/reports/stock-adjustments", { query: filters }),
  });
}
